import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

import { compare as bcryptCompare } from 'bcryptjs'

/**
 * Password hashing, in one place so the seed and the signup route can never disagree
 * about the format.
 *
 * scrypt from the standard library rather than argon2 or bcrypt: both of those are native
 * addons that have to compile on every machine and in the Docker build, and scrypt is
 * memory-hard for the same reason they are.
 *
 * The stored string is `scrypt$<salt hex>$<hash hex>`. The scheme is written into it on
 * purpose — the day this moves to argon2, existing rows have to say what they are so they
 * can be re-hashed on next sign-in rather than locking everyone out.
 *
 * That day arrived from the other direction. The club's previous site hashed with bcrypt,
 * and importing its members brought 699 `$2b$12$…` rows in with them. So `verifyPassword`
 * reads bcrypt as well as scrypt, and `needsRehash` tells the login route to rewrite the
 * row in scrypt the first time somebody signs in with one. Nothing else may write bcrypt.
 *
 * `bcryptjs`, not `bcrypt`: plain JavaScript with nothing to compile, so the argument at
 * the top still holds. It's slow next to the native one, but it runs on one code path, at
 * most once per imported account.
 *
 * The branch is expected to die. Every legacy row that's ever going to be signed into
 * converts itself on first use; when the count reaches zero, the dependency goes with it.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

/**
 * A bcrypt string from the old site: `$2<variant>$<cost>$<salt+digest>`.
 *
 * All three variants are matched rather than just the `$2b$` the import carries. They
 * differ only in how a library of the day handled non-ASCII bytes, not in the digest, and
 * `bcryptCompare` reads all of them — so pinning this to one letter would fail closed on a
 * valid row, and fail silently.
 */
const LEGACY_BCRYPT = /^\$2[aby]?\$\d{2}\$/

/**
 * Whether a stored hash is one of the imported bcrypt rows and should be rewritten in
 * scrypt after a successful sign-in.
 *
 * The login route asks; nothing else should. In particular this is not a "should I refuse
 * it" test — a legacy row is a valid password until its owner proves it by signing in,
 * which is the only moment the plaintext exists to rehash from.
 */
export function needsRehash(stored: string): boolean {
  return LEGACY_BCRYPT.test(stored)
}

/**
 * Async, not `scryptSync`. The point of the algorithm is that it's slow and
 * memory-hungry — roughly 100ms — and the sync form spends all of that on the event loop,
 * where it blocks every other request the process is serving.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await scryptAsync(password, salt, KEY_LENGTH)

  return `scrypt$${salt}$${hash.toString('hex')}`
}

/**
 * Check a password against a stored hash.
 *
 * `timingSafeEqual` rather than `===` or `Buffer.compare`. A normal comparison stops at
 * the first differing byte, so how long it takes says how many leading bytes of the guess
 * were right — enough, over enough attempts, to reconstruct a hash a byte at a time.
 *
 * A stored value this can't make sense of is a failure, not an error: anything that isn't
 * scrypt or bcrypt is something no password should open.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  // Before the split, because a bcrypt string starts with `$`. Splitting it gives
  // `['', '2b', '12', …]` — an empty scheme, which falls through the guard below and
  // returns false. That's what an imported account looked like: a correct password,
  // silently refused. `bcryptCompare` does its own constant-time comparison.
  //
  // Caught, because it throws rather than returning false on a hash whose cost is outside
  // 4-31. Uncaught that's a 500 where the rest of this file gives a 401, and a 500 on one
  // address and a 401 on every other is the membership oracle the login route avoids.
  if (needsRehash(stored)) {
    try {
      return await bcryptCompare(password, stored)
    } catch {
      return false
    }
  }

  const [scheme, salt, expected] = stored.split('$')

  if (scheme !== 'scrypt' || !salt || !expected) return false

  const expectedBytes = Buffer.from(expected, 'hex')
  const actual = await scryptAsync(password, salt, KEY_LENGTH)

  // `timingSafeEqual` throws on a length mismatch rather than returning false, so the
  // lengths have to agree before it's called. Nothing is leaked by checking: the length of
  // a scrypt hash is a constant of this file, not a property of the password.
  if (expectedBytes.length !== actual.length) return false

  return timingSafeEqual(expectedBytes, actual)
}

/**
 * A well-formed hash that no password matches.
 *
 * Sign-in has to take the same time whether or not the address exists, or the response
 * time answers "is this person a member" for anybody who cares to ask. The login route
 * runs this through `verifyPassword` when it finds no account, so the ~100ms of scrypt is
 * spent either way.
 */
export const NO_SUCH_PASSWORD = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LENGTH)}`
