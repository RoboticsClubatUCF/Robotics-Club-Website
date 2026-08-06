import { randomBytes, scrypt } from 'node:crypto'
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
 * There is no comparison here because nothing signs in yet. Whatever adds the
 * login route adds it, and it has to use `timingSafeEqual` rather than `===`:
 * comparing hashes bails at the first differing byte, and how long that takes
 * says how much of the guess was right.
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
