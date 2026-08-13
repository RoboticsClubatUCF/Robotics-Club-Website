/**
 * Somebody's initials, for the avatar that stands in until profile photos are
 * a thing.
 *
 * First letter of the first word and first letter of the last. That is what
 * `fullName` actually holds — signup writes "first last" joined, and a roster
 * row an officer typed is the same shape — so anything in the middle is a
 * middle name or a particle, and skipping it is what keeps this to the two
 * characters the square is drawn for.
 *
 * `Array.from` rather than `name[0]`: a first letter outside the basic plane is
 * a surrogate pair, and indexing one splits it into half a character that
 * renders as a replacement box.
 */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)

  // Never an empty string. Something has gone wrong upstream if a signed-in
  // account has no name at all, and an avatar with nothing in it looks like a
  // rendering bug rather than like missing data.
  if (words.length === 0) return '?'

  const first = Array.from(words[0]!)[0] ?? ''
  const last =
    words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : ''

  return (first + last).toUpperCase()
}
