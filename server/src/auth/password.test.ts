import { describe, expect, it } from 'vitest'
import { NO_SUCH_PASSWORD, hashPassword, needsRehash, verifyPassword } from './password.js'

/**
 * The hashing primitives, on their own. No database, no Hono, no Discord — these are four pure
 * functions, and the suite is worth having only because one of them silently returns `false` for
 * anything it cannot parse, which is exactly what a broken import looks like from the outside.
 *
 * The bcrypt half exists because the club's previous site hashed with bcrypt and its members were
 * imported carrying those hashes. What is under test is that a real legacy hash opens, a wrong
 * password against one does not, and `hashPassword` never produces one.
 */

/**
 * Published bcrypt test vectors, from the OpenBSD reference suite by way of jBCrypt — not generated
 * by `bcryptjs`.
 *
 * That is the whole point of hard-coding them. A vector this file produced itself would only prove
 * `bcryptjs` agrees with `bcryptjs`; these were produced by a different implementation years ago,
 * so matching them is evidence the library reads what the old site wrote.
 */
const VECTORS: ReadonlyArray<readonly [string, string]> = [
  ['abc', '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i'],
  ['a', '$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe'],
  [
    'abcdefghijklmnopqrstuvwxyz',
    '$2a$10$fVH8e28OQRj9tqiDXs1e1uxpsjN0c7II7YPKXua2NAKYvM6iQk7dq',
  ],
]

/**
 * The shape the old site actually stored: `$2b$`, cost 12. Generated once and
 * pinned here rather than computed in `beforeEach`, so a change to the
 * library's *output* cannot quietly change what is being verified against.
 */
const LEGACY_HASH = '$2b$12$1zCW8SFMsM.UndMzwGUzBuLE/.vT88Xbq9kdO4S80sfKU6jehpwzu'
const LEGACY_PASSWORD = 'a-long-enough-password'

describe('hashPassword', () => {
  it('produces a scrypt string that verifies', async () => {
    const stored = await hashPassword('correct horse battery staple')

    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('never produces a legacy hash', async () => {
    expect(needsRehash(await hashPassword(LEGACY_PASSWORD))).toBe(false)
  })

  it('salts, so the same password twice is two different strings', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('right')

    expect(await verifyPassword('wrong', stored)).toBe(false)
  })
})

describe('needsRehash', () => {
  it('recognises every bcrypt variant', () => {
    for (const variant of ['$2a$', '$2b$', '$2y$']) {
      expect(needsRehash(`${variant}12$abcdefghijklmnopqrstuv`)).toBe(true)
    }
  })

  it('is false for scrypt, including the sentinel', async () => {
    expect(needsRehash(await hashPassword('x'))).toBe(false)
    expect(needsRehash(NO_SUCH_PASSWORD)).toBe(false)
  })

  it('is false for anything unparseable, rather than throwing', () => {
    for (const junk of ['', 'not-a-hash', '$2$', '$2b$', 'scrypt', '$1$md5crypt$x']) {
      expect(needsRehash(junk)).toBe(false)
    }
  })
})

describe('verifyPassword against imported bcrypt rows', () => {
  it('opens the published vectors', async () => {
    for (const [password, stored] of VECTORS) {
      expect(await verifyPassword(password, stored)).toBe(true)
    }
  })

  it('refuses the wrong password against a vector', async () => {
    for (const [password, stored] of VECTORS) {
      expect(await verifyPassword(`${password}x`, stored)).toBe(false)
    }
  })

  it('opens a cost-12 hash of the shape the old site stored', async () => {
    expect(await verifyPassword(LEGACY_PASSWORD, LEGACY_HASH)).toBe(true)
    expect(await verifyPassword('not-it', LEGACY_HASH)).toBe(false)
  })

  it('returns false for a malformed bcrypt string instead of throwing', async () => {
    await expect(verifyPassword('x', '$2b$12$too-short')).resolves.toBe(false)
    await expect(verifyPassword('x', '$2b$99$' + 'z'.repeat(53))).resolves.toBe(false)
  })
})

describe('verifyPassword on anything else', () => {
  it('refuses a stored value it cannot make sense of', async () => {
    for (const junk of ['', 'not-a-hash', 'scrypt$', 'scrypt$onlysalt', 'md5$a$b']) {
      expect(await verifyPassword('anything', junk)).toBe(false)
    }
  })

  it('refuses the sentinel, which is the point of it', async () => {
    expect(await verifyPassword('', NO_SUCH_PASSWORD)).toBe(false)
    expect(await verifyPassword('anything at all', NO_SUCH_PASSWORD)).toBe(false)
  })
})
