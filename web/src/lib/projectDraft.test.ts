import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftFromFile, draftFromUrl, publishDraft, releaseDraftImage } from './projectDraft'
import { urlOf } from '../test/stubFetch'

/**
 * Turning a filled-in create page into rows on a project that now exists.
 *
 * The two rules worth protecting are both about what happens *after* the
 * project has been created, when there is no longer an option to give up: the
 * pictures must land in the order they were added, and nothing may throw,
 * because the caller is holding a live project and needs to be told what got
 * there rather than handed an exception.
 */

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const stub = (answer: (url: string, init?: RequestInit) => Promise<Response>) => {
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    answer(urlOf(input), init),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

const anImage = (id: string) =>
  json({ id, url: 'https://example.test/a.png', caption: null, focalX: 50, focalY: 50, zoom: 1 }, 201)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('publishDraft', () => {
  it('sends the links once and each picture in turn', async () => {
    let made = 0
    const fetchMock = stub((url) => {
      if (url.endsWith('/links')) return json([{ id: 'l1', label: 'Doc', url: 'https://a.test' }])
      made += 1
      return anImage(`i${made}`)
    })

    const result = await publishDraft('p1', {
      links: [{ label: 'Doc', url: 'https://a.test' }],
      images: [
        draftFromUrl('https://example.test/a.png'),
        draftFromUrl('https://example.test/b.png'),
      ],
    })

    expect(result.failures).toEqual([])
    expect(result.links).toHaveLength(1)
    expect(result.images.map((image) => image.id)).toEqual(['i1', 'i2'])

    const bodies = fetchMock.mock.calls
      .filter(([input]) => urlOf(input).endsWith('/images'))
      .map(([, init]) => JSON.parse(init!.body as string) as { url: string })
    expect(bodies.map((body) => body.url)).toEqual([
      'https://example.test/a.png',
      'https://example.test/b.png',
    ])
  })

  /** No links means no request — an empty set is not something to store. */
  it('does not ask about links there are none of', async () => {
    const fetchMock = stub(() => anImage('i1'))

    await publishDraft('p1', {
      links: [],
      images: [draftFromUrl('https://example.test/a.png')],
    })

    expect(
      fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/links')),
    ).toHaveLength(0)
  })

  /**
   * Untouched framing is left off entirely, so the row takes the column
   * defaults rather than being written with the same three numbers.
   */
  it('sends framing only when the picture was framed', async () => {
    const fetchMock = stub(() => anImage('i1'))

    const framed = draftFromUrl('https://example.test/b.png')
    framed.framing = { focalX: 20, focalY: 80, zoom: 2 }

    await publishDraft('p1', {
      links: [],
      images: [draftFromUrl('https://example.test/a.png'), framed],
    })

    const [plain, moved] = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init!.body as string) as Record<string, unknown>,
    )
    expect(plain).not.toHaveProperty('zoom')
    expect(moved).toMatchObject({ focalX: 20, focalY: 80, zoom: 2 })
  })

  /**
   * The whole reason this returns rather than throws. The project is already
   * live by now, so one bad picture must not cost the caller the other three.
   */
  it('keeps going past a picture that fails, and names it', async () => {
    let made = 0
    stub((url) => {
      if (url.endsWith('/links')) return json([])
      made += 1
      return made === 2 ? json({ error: 'Nope' }, 500) : anImage(`i${made}`)
    })

    const result = await publishDraft('p1', {
      links: [],
      images: [
        draftFromUrl('https://example.test/a.png'),
        draftFromUrl('https://example.test/b.png'),
        draftFromUrl('https://example.test/c.png'),
      ],
    })

    expect(result.images).toHaveLength(2)
    expect(result.failures).toEqual(['Picture 2 could not be added. Add it below.'])
  })

  it('names failed links in the plural the reader would use', async () => {
    stub((url) =>
      url.endsWith('/links') ? json({ error: 'Nope' }, 500) : anImage('i1'),
    )

    const result = await publishDraft('p1', {
      links: [
        { label: 'Doc', url: 'https://a.test' },
        { label: 'Log', url: 'https://b.test' },
      ],
      images: [],
    })

    expect(result.failures).toEqual(['The 2 links could not be saved. Add them below.'])
  })

  /** An upload goes as multipart, with the file attached under `file`. */
  it('uploads a chosen file rather than posting its name', async () => {
    const fetchMock = stub(() => anImage('i1'))

    const file = new File([new Uint8Array([1, 2, 3])], 'rover.png', {
      type: 'image/png',
    })
    const draft = draftFromFile(file)

    await publishDraft('p1', { links: [], images: [draft] })

    const [input, init] = fetchMock.mock.calls[0]
    expect(urlOf(input)).toContain('/images/upload')
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init!.body as FormData).get('file')).toBe(file)

    releaseDraftImage(draft)
  })
})
