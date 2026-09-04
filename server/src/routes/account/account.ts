import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { socialUrl, validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import { checkDiscordHandle, isHandleShaped, normaliseHandle } from '../../discord/discord.js'
import { pushRoleStrip, pushRoles } from '../../discord/discordRoles.js'
import { env } from '../../core/env.js'
import { deleteIfStored, looksLikeImage, storeFile } from '../../files/files.js'
import { FileKind } from '../../generated/prisma/enums.js'
import { sendEmailChange } from '../../email/mail.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import { rateLimit } from '../../core/rateLimit.js'
import {
  type AuthEnv,
  clearSessionCookie,
  dropOtherSessions,
  originGuard,
  requireAuth,
} from '../../auth/session.js'
import { shape } from './auth.js'
import { HOLDING } from '../member/equipment.js'
import { framingFields, framingFromBody } from '../projects/projectManage.js'
import { DISCORD_TAKEN, handleStatus, uniqueConflict } from './signup.js'

/**
 * The account, as its owner manages it.
 *
 *   GET    /api/account                -> the editable profile
 *   PATCH  /api/account/profile        { fullName?, bio?, gradYear? }
 *   PATCH  /api/account/profile-link   { profileUrl }       -> { profileUrl }
 *   POST   /api/account/discord-check  { discordUsername }  -> { status }
 *   POST   /api/account/discord        { discordUsername }  -> { user }
 *   POST   /api/account/photo          multipart + framing  -> { user }
 *   PATCH  /api/account/photo          { focalX?, focalY?, zoom? }
 *   DELETE /api/account/photo                               -> { user }
 *   POST   /api/account/password       { currentPassword, newPassword }
 *   POST   /api/account/email          { password, email }  -> 202
 *   POST   /api/account/email/confirm  { token }            -> { user }
 *   DELETE /api/account                { password }         -> 200
 *
 * Everything here is somebody acting on their own row, so `requireAuth` is the whole
 * authorisation story. An officer editing somebody else is the roles desk.
 *
 * Nothing here is dues-gated: being behind on dues isn't a reason somebody can't
 * change their password or leave.
 *
 * Mounted outside `publicApi`. Every answer is per-caller, and a cached one served to
 * the next visitor would be somebody else's account.
 *
 * The three writes that touch a credential — password, email, deletion — all ask for
 * the current password first. That's what keeps a session somebody walked away from
 * at a lab bench from being enough to take an account over, and it's why there's no
 * "your address was changed" notice email.
 */
export const account = new Hono<AuthEnv>()

/** The ordinary writes. Ten rather than five: this is a settings page, and somebody
    tidying up their profile does four or five things in a sitting. */
const writes = rateLimit('account', 10)

/** The field that re-checks itself as a typo is corrected, same as signup's. */
const checks = rateLimit('account-check', 30)

/** Uploads are their own budget, as they are on the project editor. */
const uploads = rateLimit('account-upload', 10)

/** The token is a credential, so only its hash is ever compared or stored. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

const WRONG_PASSWORD = 'That password is not right.'

/**
 * Prove it's really them before a credential moves.
 *
 * An account with no `passwordHash` — a roster entry an officer typed in — can't pass
 * this and isn't meant to: it also can't sign in, so nobody is standing here holding
 * one. Refusing is the safe direction, and the reset link is the way through.
 */
async function requirePassword(userId: string, password: string): Promise<void> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })

  if (!row?.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
    throw new HTTPException(401, { message: WRONG_PASSWORD })
  }
}

/** Everything the profile page edits, plus the two facts it cannot derive. */
/**
 * A year, loosely. The bounds stop a typo becoming a roster entry that graduated in
 * the year 202 — not to have an opinion about how long somebody has been at UCF.
 *
 * Exported because the member survey asks the same question and writes the same
 * column. Two writers spelling the bounds separately is how one eventually accepts
 * what the other refuses; the survey requires it and this page allows null, which is
 * the only difference and is expressed at each call site.
 */
export const gradYearField = z.coerce.number().int().min(1960).max(2100)

const profileSelect = {
  id: true,
  fullName: true,
  email: true,
  slug: true,
  role: true,
  discordUsername: true,
  photoUrl: true,
  photoFocalX: true,
  photoFocalY: true,
  photoZoom: true,
  bio: true,
  gradYear: true,
  profileUrl: true,
  acknowledgementAcceptedAt: true,
} as const

// ------------------------------------------------------------------- read

account.get('/', requireAuth, async (c) => {
  const id = c.get('user').id

  const [user, pending] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: { ...profileSelect, passwordHash: true },
    }),
    prisma.emailChange.findUnique({
      where: { userId: id },
      select: { newEmail: true, expiresAt: true },
    }),
  ])

  const { passwordHash, ...rest } = user

  return c.json({
    ...rest,
    /**
     * Whether there is a password to change, rather than the hash itself.
     *
     * False for a roster entry an officer created by hand, and the page says "set a
     * password" instead of asking for a current one it knows doesn't exist.
     */
    passwordSet: passwordHash !== null,
    /**
     * An address waiting on its confirmation link, or null. Without it the page has
     * nothing to show between asking for a change and following the link, and "I asked
     * and nothing happened" is what somebody concludes from a form that reset itself.
     */
    pendingEmail:
      pending && pending.expiresAt > new Date() ? pending.newEmail : null,
  })
})

// ---------------------------------------------------------------- profile

account.patch(
  '/profile',
  originGuard,
  requireAuth,
  writes,
  validate(
    'json',
    z.object({
      fullName: z.string().trim().min(1).max(100),
      /**
       * Nullable as well as optional, and the empty string counts as null: clearing a
       * bio is a thing somebody does, and a row holding `''` reads as an empty
       * paragraph on the public roster rather than as no bio.
       */
      bio: z
        .string()
        .trim()
        .max(2000)
        .nullable()
        .transform((value) => value || null),
      gradYear: gradYearField.nullable(),
    }),
  ),
  async (c) => {
    const user = await prisma.user.update({
      where: { id: c.get('user').id },
      data: c.req.valid('json'),
      select: profileSelect,
    })

    return c.json({ user: shape(user) })
  },
)

/**
 * Where this member's photograph points, or nothing.
 *
 * Its own route rather than a fourth field on `/profile`: a panel is one decision with
 * one save, and putting a link to somebody's LinkedIn in the same press as their name
 * and bio is the shape that makes people careful about pressing anything. It's also
 * the one field here that can be refused on its content.
 *
 * `socialUrl` is the whole check — an allowlist, because this is the only column an
 * ordinary member writes that ends up in an `href` on a public page. `null` clears it.
 *
 * The answer is the stored address and not `shape(user)`, deliberately: nothing on the
 * session draws this, so putting it there would mean every page load in the club
 * carrying a field two public pages use.
 */
account.patch(
  '/profile-link',
  originGuard,
  requireAuth,
  writes,
  validate('json', z.object({ profileUrl: socialUrl().nullable() })),
  async (c) => {
    const { profileUrl } = await prisma.user.update({
      where: { id: c.get('user').id },
      data: c.req.valid('json'),
      select: { profileUrl: true },
    })

    return c.json({ profileUrl })
  },
)

// ---------------------------------------------------------------- discord

const handleSchema = z.object({
  discordUsername: z.string().trim().min(1).max(64),
})

/**
 * The signup check, with the caller excused.
 *
 * Its own route rather than a flag on the public one, because "don't count this
 * account" has to be decided from a session and never from the request body — a
 * parameter naming the row to skip would be a way to claim anybody's handle.
 */
account.post(
  '/discord-check',
  originGuard,
  requireAuth,
  checks,
  validate('json', handleSchema),
  async (c) => {
    return c.json(
      await handleStatus(c.req.valid('json').discordUsername, c.get('user').id),
    )
  },
)

/**
 * Change the Discord handle on file.
 *
 * The same refusals as `signup/complete`, deliberately: `not_found` is a typo or a
 * display name, `unavailable` means Discord didn't answer and is refused rather than
 * guessed at — a handle stored while Discord was down looks exactly like a confirmed
 * one from then on, and nearly everything the club builds joins on this string.
 */
account.post(
  '/discord',
  originGuard,
  requireAuth,
  writes,
  validate('json', handleSchema),
  async (c) => {
    const me = c.get('user')
    const handle = normaliseHandle(c.req.valid('json').discordUsername)

    const check = isHandleShaped(handle)
      ? await checkDiscordHandle(handle)
      : ({ status: 'not_found' } as const)

    if (check.status === 'not_found') {
      throw new HTTPException(422, { message: 'Cannot find that user.' })
    }

    if (check.status === 'unavailable') {
      throw new HTTPException(503, {
        message:
          'We could not reach Discord to confirm that username. Try again in a minute.',
      })
    }

    try {
      const user = await prisma.user.update({
        where: { id: me.id },
        data: {
          // Discord's own spelling when it answered, as typed when no bot is
          // configured — the same choice `complete` makes.
          discordUsername:
            check.status === 'connected' ? check.username : handle,
          /**
           * Only written when Discord actually answered.
           *
           * Left alone on `unchecked`: the snowflake is the account and doesn't change
           * when somebody renames themselves, so clearing it on an unverifiable edit
           * would throw away the one durable thing on the row. `discordRecipient`
           * re-resolves it from the handle if it's ever wrong.
           */
          ...(check.status === 'connected' ? { discordId: check.id } : {}),
        },
        select: profileSelect,
      })

      // The site may now match them to a different guild member, so what they should be
      // carrying is worth recomputing. Fire-and-forget: nothing on this request depends
      // on Discord answering.
      pushRoles(me.id, 'discord username changed')

      return c.json({ user: shape(user) })
    } catch (error) {
      // Both columns are unique. `discord-check` already said this, but that answer went
      // to a browser and came back, and the constraint is what actually decides it.
      if (uniqueConflict(error) === 'discord') {
        throw new HTTPException(409, { message: DISCORD_TAKEN })
      }

      throw error
    }
  },
)

// ------------------------------------------------------------------ photo

const NOT_AN_IMAGE =
  'That file is not an image the site can show. PNG, JPEG, GIF or WebP.'

/**
 * A profile photo, the same job as a project cover and done the same way — see
 * `projectManage.ts`. `bodyLimit` runs first, because the cap has to refuse the body
 * before this process is holding it.
 *
 * The framing arrives with the picture, exactly as for a gallery image added from the
 * create page. It has to: the browser frames the file before sending it, so a photo
 * somebody picked by accident costs them nothing — and framing arriving as a second
 * request could fail on its own and leave the new photo cropped by the old one's
 * numbers.
 */
account.post(
  '/photo',
  originGuard,
  requireAuth,
  bodyLimit({
    maxSize: env.MAX_IMAGE_FILE_MB * 1024 * 1024 + 64 * 1024,
    onError: () => {
      throw new HTTPException(413, {
        message: `That image is too big — the cap is ${env.MAX_IMAGE_FILE_MB} MB.`,
      })
    },
  }),
  uploads,
  async (c) => {
    const me = c.get('user')

    const body = await c.req.parseBody()
    const file = body['file']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'No file was uploaded.' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeImage(bytes)) {
      throw new HTTPException(400, { message: NOT_AN_IMAGE })
    }

    // Multipart carries no types, so this reads the three numbers back out of strings
    // and drops anything unparseable — the picture is the point of the request, and a
    // column default is a correct answer for how it's framed.
    const { focalX, focalY, zoom } = framingFromBody(body)

    const { url } = await storeFile(FileKind.IMAGE, file, me.id)

    const user = await prisma.user.update({
      where: { id: me.id },
      data: {
        photoUrl: url,
        // Written every time, defaults included. A new photo must not inherit the crop
        // of the one it replaced: the numbers were chosen against a different picture,
        // and the result is a face half out of frame.
        photoFocalX: focalX ?? 50,
        photoFocalY: focalY ?? 50,
        photoZoom: zoom ?? 1,
      },
      select: profileSelect,
    })

    // After the write, and only if the old value was ours. A replacement mints a new id,
    // which is what makes the `immutable` cache header on `/api/files/:id` honest.
    await deleteIfStored(me.photoUrl)

    return c.json({ user: shape(user) })
  },
)

/**
 * Move the crop on the photo already on file, without sending it again.
 *
 * The other half of framing being metadata rather than a crop baked into the bytes:
 * somebody can change their mind a year later, from any device, without the original
 * file to hand.
 *
 * Every field is optional and applied only when sent, matching the gallery's edit
 * route — so a future caller adjusting zoom alone can't silently re-centre a photo.
 */
account.patch(
  '/photo',
  originGuard,
  requireAuth,
  writes,
  validate('json', z.object(framingFields)),
  async (c) => {
    const me = c.get('user')
    const { focalX, focalY, zoom } = c.req.valid('json')

    if (!me.photoUrl) {
      throw new HTTPException(409, {
        message: 'There is no photo to frame yet.',
      })
    }

    const user = await prisma.user.update({
      where: { id: me.id },
      data: {
        ...(focalX === undefined ? {} : { photoFocalX: focalX }),
        ...(focalY === undefined ? {} : { photoFocalY: focalY }),
        ...(zoom === undefined ? {} : { photoZoom: zoom }),
      },
      select: profileSelect,
    })

    return c.json({ user: shape(user) })
  },
)

account.delete('/photo', originGuard, requireAuth, writes, async (c) => {
  const me = c.get('user')

  const user = await prisma.user.update({
    where: { id: me.id },
    data: {
      photoUrl: null,
      // Back to centred with it. Framing left behind belongs to a picture that no longer
      // exists, and the next upload would start half-cropped by it.
      photoFocalX: 50,
      photoFocalY: 50,
      photoZoom: 1,
    },
    select: profileSelect,
  })

  await deleteIfStored(me.photoUrl)

  return c.json({ user: shape(user) })
})

// --------------------------------------------------------------- password

account.post(
  '/password',
  originGuard,
  requireAuth,
  writes,
  validate(
    'json',
    z.object({
      currentPassword: z.string().min(1).max(200),
      /** Long, and nothing else — signup's rule, and its comment is the argument. This
          is a point where a password is set, which is the only place such a rule
          belongs. */
      newPassword: z.string().min(10).max(200),
    }),
  ),
  async (c) => {
    const me = c.get('user')
    const { currentPassword, newPassword } = c.req.valid('json')

    await requirePassword(me.id, currentPassword)

    await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: await hashPassword(newPassword) },
    })

    // Everywhere but here. Somebody changing a password because another person has it
    // needs that other person signed out; somebody changing it for tidiness shouldn't be
    // signed out of the tab they're looking at.
    const ended = await dropOtherSessions(me.id, c.get('sessionToken'))

    return c.json({ status: 'changed', otherSessionsEnded: ended })
  },
)

// ------------------------------------------------------------------ email

const EMAIL_TAKEN = 'There is already an account for that email.'

/**
 * Ask to move the address the account signs in with.
 *
 * Two steps with an email in between, exactly as signup is, and the reason is sharper
 * here: a mistyped address on signup is a link that never arrives, while a mistyped
 * address written onto an existing account is somebody locked out of a site they're a
 * member of.
 *
 * No `@ucf.edu` restriction, unlike signup — roster entries an officer typed in and
 * the seeded admin account are real logins on other domains.
 */
account.post(
  '/email',
  originGuard,
  requireAuth,
  writes,
  validate(
    'json',
    z.object({
      password: z.string().min(1).max(200),
      email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
    }),
  ),
  async (c) => {
    const me = c.get('user')
    const { password, email } = c.req.valid('json')

    await requirePassword(me.id, password)

    if (email === me.email) {
      throw new HTTPException(409, {
        message: 'That is already the address on this account.',
      })
    }

    const taken = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })

    if (taken) throw new HTTPException(409, { message: EMAIL_TAKEN })

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(
      Date.now() + env.ACCOUNT_TOKEN_TTL_MINUTES * 60_000,
    )
    const tokenHash = hashToken(token)

    // Keyed on the account, so asking again replaces the pending change. A mistyped
    // address must not leave a live link pointing at the typo.
    await prisma.emailChange.upsert({
      where: { userId: me.id },
      update: { newEmail: email, tokenHash, expiresAt },
      create: { userId: me.id, newEmail: email, tokenHash, expiresAt },
    })

    let sent: boolean

    try {
      sent = await sendEmailChange(email, token)
    } catch (error) {
      console.error(`email change ${me.id}: email failed`, error)
      throw new HTTPException(502, {
        message: 'We could not send that email just now. Try again in a minute.',
      })
    }

    if (!sent) {
      if (env.NODE_ENV === 'production') {
        console.error(
          'email change: POSTMARK_TOKEN is not configured — no confirmation can be sent',
        )
        throw new HTTPException(503, {
          message:
            'Changing your email is temporarily unavailable. Please contact an officer.',
        })
      }

      console.log(
        `email change ${me.id}: no mailer configured — confirmation link is ${env.emailChangeUrl}?emailToken=${encodeURIComponent(token)}`,
      )
    }

    // 202: the link is out and nothing has moved yet. The expiry goes back so the page
    // can say how long they have without hardcoding this server's configuration.
    return c.json(
      {
        status: 'sent',
        email,
        expiresInMinutes: env.ACCOUNT_TOKEN_TTL_MINUTES,
      },
      202,
    )
  },
)

/**
 * Spend the link, and move the address.
 *
 * Deliberately not `requireAuth`. The token is the proof and it arrives in an inbox,
 * very often on a phone that has never signed into this site. Requiring a session
 * would mean the confirmation only works from the browser the change was started in.
 *
 * Safe to leave open because the token is the credential: 256 bits, kept as a hash,
 * single use, and it can only ever set the one address it was minted for onto the one
 * account that asked.
 */
account.post(
  '/email/confirm',
  originGuard,
  checks,
  validate('json', z.object({ token: z.string().min(1).max(200) })),
  async (c) => {
    const pending = await prisma.emailChange.findUnique({
      where: { tokenHash: hashToken(c.req.valid('json').token) },
      select: { id: true, userId: true, newEmail: true, expiresAt: true },
    })

    // Expired, unknown and already-spent are one 410 with one sentence, as everywhere
    // else: they're the same thing from where the reader stands.
    if (!pending || pending.expiresAt <= new Date()) {
      throw new HTTPException(410, {
        message:
          'That link has expired or has already been used. Ask for a new one from your profile page.',
      })
    }

    try {
      const [user] = await prisma.$transaction([
        prisma.user.update({
          where: { id: pending.userId },
          data: { email: pending.newEmail },
          select: profileSelect,
        }),
        // In the same transaction as the change: a spent link left live is a second way
        // to move an address nobody is expecting to move again.
        prisma.emailChange.delete({ where: { id: pending.id } }),
      ])

      return c.json({ user: shape(user) })
    } catch (error) {
      // Checked when the change was asked for, so reaching this means somebody else took
      // the address in between. The constraint is what decides it.
      if (uniqueConflict(error) === 'email') {
        throw new HTTPException(409, { message: EMAIL_TAKEN })
      }

      throw error
    }
  },
)

// ----------------------------------------------------------------- delete

/**
 * Delete the account, and mean it.
 *
 * The cascades take the sessions, dues payments, print requests, loans and project
 * memberships with the row. Closed officer terms survive with the name already written
 * on them and a null `userId` — the club's archive isn't somebody's to delete by
 * leaving.
 *
 * Two things are refused rather than cascaded, both cases where deleting leaves the
 * club holding a problem it can't see. Equipment still out: the loan row is the only
 * record that a thing left the lab, so the club would be short a drill with nothing to
 * say who has it. And an open officer term: standing down is the board's business, and
 * a seat vacated this way leaves a card on the public page with a null account behind
 * it.
 *
 * The Discord roles are taken back separately, because nothing else can: the role
 * sweep skips anybody it can't match to a row, so an account that has just deleted its
 * row would keep Members and Project Leads for ever.
 */
account.delete(
  '/',
  originGuard,
  requireAuth,
  writes,
  validate('json', z.object({ password: z.string().min(1).max(200) })),
  async (c) => {
    const me = c.get('user')

    await requirePassword(me.id, c.req.valid('json').password)

    const holding = await prisma.equipmentLoan.findMany({
      where: { userId: me.id, status: { in: [...HOLDING] } },
      select: { equipment: { select: { name: true } } },
    })

    if (holding.length > 0) {
      const names = [
        ...new Set(holding.map((loan) => loan.equipment.name)),
      ].join(', ')

      throw new HTTPException(409, {
        message: `You still have club equipment out — ${names}. Return it first, and an officer will check it back in.`,
      })
    }

    const seat = await prisma.officerTerm.findFirst({
      where: { userId: me.id, endedAt: null },
      select: { id: true },
    })

    if (seat) {
      throw new HTTPException(409, {
        message:
          'You are still on the officer board. Ask the board to stand you down first — that closes your term and keeps it in the club archive.',
      })
    }

    /**
     * Read before the row goes, because none of it is knowable afterwards.
     *
     * The stored files are the half the cascades get wrong: `StoredFile.createdById` is
     * `SetNull`, so their bytes would stay in Postgres owned by nobody. Only what this
     * account points at — its photo, and the models behind its own print requests. A
     * project's gallery images belong to the project, whoever uploaded them.
     */
    const owned = await prisma.user.findUniqueOrThrow({
      where: { id: me.id },
      select: {
        fullName: true,
        discordId: true,
        discordUsername: true,
        photoUrl: true,
        printRequests: { select: { fileId: true } },
      },
    })

    const fileIds = owned.printRequests
      .map((request) => request.fileId)
      .filter((id): id is string => id !== null)

    await prisma.user.delete({ where: { id: me.id } })

    // After the account is actually gone. Cleanup that can fail the request it rides on
    // is worse than a stray row, which is the rule `deleteIfStored` already follows.
    await deleteIfStored(owned.photoUrl)

    if (fileIds.length > 0) {
      await prisma.storedFile.deleteMany({ where: { id: { in: fileIds } } })
    }

    // The snowflake read above, since the row it came from no longer exists. Null for
    // anyone the site never matched to a Discord account, which is the ordinary state of
    // a roster entry and of an unconfigured bot.
    if (owned.discordId) {
      pushRoleStrip(owned.discordId, owned.fullName, 'account deleted')
    }

    // The session went with the row; the cookie is this browser's and has to be told.
    // Without it the next request arrives with a token pointing at nothing, which
    // resolves to signed-out anyway — but leaves a dead cookie looking like a session.
    clearSessionCookie(c)

    return c.json({ status: 'deleted' })
  },
)

/** Drop email changes that have already expired. Same timer as the others. */
export async function sweepEmailChanges(): Promise<number> {
  const { count } = await prisma.emailChange.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  return count
}
