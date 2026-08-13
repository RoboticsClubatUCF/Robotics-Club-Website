import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Password hashing, in one place so the seed and the signup route can never
 * disagree about the format.
 *
 * scrypt from the standard library rather than argon2 or bcrypt: both of those
 * are native addons that have to compile on every machine and in the Docker
 * build, and scrypt is memory-hard for the same reason they are. Nothing here
 * needs a dependency.
 *
 * The stored string is `scrypt$<salt hex>$<hash hex>`. The scheme is written
 * into it on purpose — the day this moves to argon2, existing rows have to say
 * what they are so they can be re-hashed on next sign-in rather than locking
 * everyone out.
 *
 * `verifyPassword` is the other half, and it compares with `timingSafeEqual`
 * rather than `===` for the reason below.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

/**
 * Async, not `scryptSync`. The whole point of the algorithm is that it is slow
 * and memory-hungry — roughly 100ms here — and the sync form spends all of that
 * on the event loop, where it blocks every other request the process is
 * serving. One signup would stall every page read behind it.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await scryptAsync(password, salt, KEY_LENGTH)

  return `scrypt$${salt}$${hash.toString('hex')}`
}

/**
 * Check a password against a stored hash.
 *
 * `timingSafeEqual` rather than `===` or `Buffer.compare`. A normal comparison
 * stops at the first differing byte, so how long it takes says how many leading
 * bytes of the guess were right — enough, over enough attempts, to reconstruct
 * a hash a byte at a time without ever being told a password was correct.
 *
 * A stored value this cannot make sense of is a failure, not an error. The
 * scheme is written into the string so that the day this moves off scrypt an
 * old row says what it is and can be re-hashed on next sign-in; until then,
 * anything that is not scrypt is something no password should open.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, expected] = stored.split('$')

  if (scheme !== 'scrypt' || !salt || !expected) return false

  const expectedBytes = Buffer.from(expected, 'hex')
  const actual = await scryptAsync(password, salt, KEY_LENGTH)

  // `timingSafeEqual` throws on a length mismatch rather than returning false,
  // so the lengths have to agree before it is called. Nothing is leaked by
  // checking: the length of a scrypt hash is a constant of this file, not a
  // property of the password.
  if (expectedBytes.length !== actual.length) return false

  return timingSafeEqual(expectedBytes, actual)
}

/**
 * A well-formed hash that no password matches.
 *
 * Sign-in has to take the same time whether or not the address exists, or the
 * response time answers "is this person a member" for anybody who cares to
 * ask — which is a roster of student email addresses, handed out one guess at a
 * time. The login route runs this through `verifyPassword` when it finds no
 * account, so the ~100ms of scrypt is spent either way.
 */
export const NO_SUCH_PASSWORD = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LENGTH)}`
