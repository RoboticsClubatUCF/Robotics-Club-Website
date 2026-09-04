import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilePhotoPanel } from './ProfilePhotoPanel'
import { SessionProvider } from '../../lib/auth/auth'
import type { ApiAccount } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The profile photo.
 *
 * The property this suite exists for is the one that separates it from every other upload on the
 * site: choosing a file uploads nothing. An avatar replaces, and replacing deletes the old bytes,
 * so a mis-picked file has to cost nothing until somebody has looked at it in the frame it will
 * appear in.
 *
 * The rest is that framing travels with the picture rather than as a second request, and that
 * re-framing what is already stored sends no bytes at all.
 */

const account: ApiAccount = {
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'MEMBER',
  discordUsername: 'rowan',
  photoUrl: null,
  photoFocalX: 50,
  photoFocalY: 50,
  photoZoom: 1,
  profileUrl: null,
  bio: null,
  gradYear: null,
  acknowledgementAcceptedAt: null,
  passwordSet: true,
  pendingEmail: null,
}

const withPhoto: ApiAccount = {
  ...account,
  photoUrl: '/api/files/abc',
  photoFocalX: 30,
  photoFocalY: 70,
  photoZoom: 2,
}

/** A PNG by its magic bytes, small enough that `downscaleImage` leaves it be. */
const pngFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'face.png', {
    type: 'image/png',
  })

function stubApi() {
  // `{ user }` answers both the session read and every write here, so one
  // response body covers the panel's whole surface.
  const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({ user: { ...account, photoUrl: '/api/files/new' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  )

  vi.stubGlobal('fetch', stub)
  return stub
}

const renderPanel = (data: ApiAccount = account) =>
  render(
    <SessionProvider>
      <ProfilePhotoPanel account={data} onSaved={() => {}} />
    </SessionProvider>,
  )

/** Picking a file, which is the only way into the framer. */
async function choose() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/add a photo|replace it/i), {
      target: { files: [pngFile()] },
    })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('choosing a photo', () => {
  /**
   * The whole reason this panel does not follow the project editor's
   * "choosing the file *is* the upload" rule. An avatar replaces, and the old
   * bytes are deleted when it does.
   */
  it('uploads nothing until it is confirmed', async () => {
    const stub = stubApi()
    renderPanel()

    await choose()

    // The framer is open on it, and the panel says so.
    expect(
      screen.getByRole('application', { name: /drag to choose/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/nothing is uploaded until/i)).toBeInTheDocument()

    expect(
      stub.mock.calls.some(([input]) => urlOf(input).includes('/account/photo')),
    ).toBe(false)
  })

  it('sends the picture and its framing in one request', async () => {
    const stub = stubApi()
    renderPanel()

    await choose()

    // Move it off centre, so the request has something to carry.
    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '2' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'USE THIS PHOTO' }))
    })

    const [, init] = stub.mock.calls.find(([input]) =>
      urlOf(input).includes('/account/photo'),
    )!

    expect(init?.method).toBe('POST')

    const body = init?.body as FormData
    expect(body.get('file')).toBeInstanceOf(File)
    // Framing rides with the picture rather than following it, so a photo
    // cannot land correctly and then be left cropped by a second request.
    expect(body.get('zoom')).toBe('2')
  })

  /** A picture nobody framed takes the column defaults rather than being
      written with the same numbers. */
  it('leaves the framing off entirely when nothing was moved', async () => {
    const stub = stubApi()
    renderPanel()

    await choose()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'USE THIS PHOTO' }))
    })

    const [, init] = stub.mock.calls.find(([input]) =>
      urlOf(input).includes('/account/photo'),
    )!

    const body = init?.body as FormData
    expect(body.get('zoom')).toBeNull()
    expect(body.get('focalX')).toBeNull()
  })

  it('discards a file on cancel, without sending it', async () => {
    const stub = stubApi()
    renderPanel()

    await choose()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    })

    expect(screen.queryByRole('application')).not.toBeInTheDocument()
    expect(
      stub.mock.calls.some(([input]) => urlOf(input).includes('/account/photo')),
    ).toBe(false)
  })
})

describe('a photo already on file', () => {
  it('offers to adjust the crop, and re-frames without sending bytes', async () => {
    const stub = stubApi()
    renderPanel(withPhoto)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ADJUST THE CROP' }))
    })

    // Opens on what is stored, not on a centred default.
    expect(screen.getByLabelText('ZOOM')).toHaveValue('2')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DONE' }))
    })

    const [, init] = stub.mock.calls.find(([input]) =>
      urlOf(input).includes('/account/photo'),
    )!

    // A PATCH of three numbers — the picture itself never moves.
    expect(init?.method).toBe('PATCH')
    expect(bodyOf(init)).toEqual({
      focalX: 30,
      focalY: 70,
      zoom: 2,
    })
  })

  /** There is no second way in while a new file is being framed: the framer is
      already open on it, and an ADJUST button beside it would do nothing. */
  it('hides adjust and remove while a new file is being framed', async () => {
    stubApi()
    renderPanel(withPhoto)

    expect(screen.getByRole('button', { name: 'ADJUST THE CROP' })).toBeInTheDocument()

    await choose()

    expect(screen.queryByRole('button', { name: 'ADJUST THE CROP' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'REMOVE' })).toBeNull()
  })
})
