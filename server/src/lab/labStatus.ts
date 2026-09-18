import { prisma } from '../core/db.js'
import {
  type BotMessage,
  type MessageComponents,
  buttonsLive,
  deleteChannelMessage,
  editChannelMessage,
  findBotMessages,
  labChannelConfigured,
  labChannelId,
  labMessageId,
  postChannelMessage,
  readChannelName,
  renameChannel,
} from '../discord/discord.js'

/**
 * Whether the lab is open, and the sign in Discord that says so.
 *
 * Discord is the record and `lab_status` is the site's copy. Three rules follow:
 *
 *   - A flip Discord won't take doesn't happen. `flipLabStatus` renames the
 *     channel first and writes the row only if that landed, so a throttled
 *     rename comes back as a cooldown and the lab is left as it was.
 *   - The sweep reads the sign back every ten minutes and corrects the row.
 *   - "Discord" means the sign — the one message the row knows it is keeping.
 *     Never any other message of the bot's: a leftover reading THE LAB IS CLOSED
 *     is indistinguishable from a sign somebody just corrected, and trusting one
 *     closed the lab for the whole club once, against the real guild.
 *
 * One message in the channel, and nothing replaces it. Every state change edits it
 * in place — opening, closing, the curfew, a sweep retry — so the sign keeps its
 * place in the channel, nobody is pinged and nothing goes unread for a fact people
 * read the channel to look up. The club is told by the channel itself: the name
 * turns green in the sidebar, which is the half of the sign somebody sees without
 * opening it. A post only happens with no message to edit at all — an empty
 * channel, or a sign somebody deleted — and `tidyChannel` on the sweep clears
 * anything else of ours, which is what makes "one message" hold rather than be
 * intended.
 *
 * The building shuts at ten, Orlando time, and that overrides Discord. Masked on
 * read so the site is right at 22:00:01, and written by the sweep so the row and
 * the channel catch up — either alone leaves something wrong. The curfew close is
 * the one write a throttled rename can't veto, and it only ever closes: a lab
 * that sprang open at 08:00 would be a sign nobody made.
 *
 * Discord allows two channel renames per ten minutes, which is why a cooldown is
 * a sentence somebody reads rather than a silent retry — a press that appeared to
 * do nothing is what gets pressed four more times.
 */

/** The one row. See `LabStatus` in `schema.prisma` for why it has a fixed id. */
const CURRENT = 'current'

/**
 * "Ten at night" means ten at night in Orlando — not UTC, where the server's
 * clock runs. A wall-clock hour isn't an offset from an instant: Florida moves by
 * an hour twice a year, so `getHours() - 4` is right for eight months of it.
 * `Intl` knows the rule, so there's no library and no stored offset to go stale.
 */
export const CAMPUS_ZONE = 'America/New_York'

/**
 * When the physical building is open, on a 24-hour clock.
 *
 * Constants rather than configuration: these are what the feature is. If the
 * hours ever change they're one edit here, and `web/src/lib/lab/lab.ts` — which
 * prints them on the dashboard — points at this pair.
 */
export const BUILDING_OPENS_AT = 8
export const BUILDING_CLOSES_AT = 22

/**
 * `hourCycle: 'h23'`, not `hour12: false`. They look equivalent and differ at one
 * hour of the day: with `hour12: false` some ICU builds render midnight as 24, so
 * `hour < 22` would call one hour a night "open" on some machines and not others.
 */
const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
})

/** The hour it is on campus right now, 0–23. */
export function campusHour(at: Date): number {
  return Number(hourFormat.format(at))
}

/**
 * Whether the building somebody would be walking to is open at all. The lab can't
 * be open when this is false, whatever the row or the channel says — an officer
 * who forgets to close up shouldn't leave a green sign up all night.
 */
export function buildingOpen(at: Date): boolean {
  const hour = campusHour(at)
  return hour >= BUILDING_OPENS_AT && hour < BUILDING_CLOSES_AT
}

/** For the sentence the route refuses with, the one Discord prints, and the
    private note a button press gets back overnight. */
const hourLabel = (hour: number) =>
  `${((hour + 11) % 12) + 1}${hour < 12 ? 'am' : 'pm'}`

export const BUILDING_HOURS_SENTENCE =
  `The building is shut between ${hourLabel(BUILDING_CLOSES_AT)} and ` +
  `${hourLabel(BUILDING_OPENS_AT)}, so the lab cannot be opened until then.`

/**
 * The cooldown, said the way somebody standing at the door would want it.
 *
 * One sentence for both callers — the dashboard's 429 and the private note a
 * button press gets — because two wordings of one fact drift. It has to say the
 * lab didn't change, say the limit is Discord's rule about a channel name rather
 * than the site being broken, and give the wait in minutes, which is the unit
 * Discord answers a rename in.
 */
export function cooldownSentence(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000))
  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? '' : 's'}`
      : `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}`

  return (
    'Discord only allows the lab channel to be renamed twice every ten minutes, ' +
    `and both have just been used. Nothing has changed — the lab is still as it was. Try again in about ${wait}.`
  )
}

/**
 * What the channel is called in each state.
 *
 * Written here rather than configured, unlike the channel id: the id is the
 * club's, but the shape of the name is what this feature is, and two more env
 * vars to say "red when shut" is one more way to get a half-configured sign.
 *
 * Discord lowercases a name and turns spaces into hyphens on the way in, so these
 * are already written the way they come back out. The emoji survives.
 */
export const LAB_CHANNEL_NAME = {
  open: 'lab-status-🟢',
  closed: 'lab-status-🔴',
} as const

/**
 * The two headlines, as the strings the sign is both written with and read back
 * out of. Constants because the reconcile decides what the lab is by looking for
 * one of them in a message posted possibly months ago — change the wording in one
 * place only and the site stops being able to read its own sign, silently.
 */
export const LAB_HEADLINE = {
  open: 'THE LAB IS OPEN',
  closed: 'THE LAB IS CLOSED',
} as const

/**
 * The `custom_id` on each button, and the only thing a press sends back to say
 * which one it was. Namespaced `lab:` because an application has one interactions
 * endpoint for everything, and the second feature to grow a button is the one
 * that discovers a bare `open` was ambiguous.
 */
export const LAB_BUTTON = {
  open: 'lab:open',
  close: 'lab:close',
} as const

/** The lab as the site knows it. `changedAt` is null when nobody has ever set it,
    which is not the same as "closed a long time ago". */
export interface LabState {
  /**
   * Already masked by the building's hours. Never `row.open` on its own: every
   * caller wants the answer somebody would act on.
   */
  open: boolean
  changedAt: Date | null
  /** Who flipped it, by name. Null for a row nobody has touched, for an account
      since deleted (`changedById` is `SetNull`), for a close the curfew did, and
      for a button pressed by somebody with no account here. */
  changedBy: string | null
  /** Whether the building is open at all — what tells "nobody has opened it" from
      "nobody can", which is a switch that's off against one that's disabled. */
  buildingOpen: boolean
}

const rowSelect = {
  open: true,
  changedAt: true,
  changedBy: { select: { fullName: true } },
} as const

const signSelect = {
  ...rowSelect,
  discordChannelId: true,
  discordMessageId: true,
  discordSynced: true,
} as const

/** Only the two columns `writeSign` needs to find the message again. */
type StoredMessage = {
  discordChannelId: string | null
  discordMessageId: string | null
}

/**
 * The row plus the clock, in one place, because several callers derive this and a
 * second copy of the mask is where it gets left out of one.
 */
function stateOf(
  row: { open: boolean; changedAt: Date; changedBy: { fullName: string } | null },
  now: Date,
): LabState {
  const building = buildingOpen(now)

  return {
    open: row.open && building,
    changedAt: row.changedAt,
    changedBy: row.changedBy?.fullName ?? null,
    buildingOpen: building,
  }
}

/**
 * What the sign says.
 *
 * `<t:…:R>` is Discord's own relative timestamp: every reader sees "20 minutes
 * ago" in their own client and it keeps counting without another edit, which a
 * formatted string wouldn't.
 *
 * Nothing here mentions anybody. The sign is a thing to look at, not an
 * interruption, and it is only ever delivered by an edit — which reaches nobody
 * however it reads — so a mention on it would be a notification that never went
 * out, sitting there looking like one somebody had missed.
 *
 * Exported for the tests, which assert on the two states rather than on whatever
 * Discord happened to accept.
 */
export function labMessage(state: LabState): string {
  const headline = state.open
    ? `🟢 **${LAB_HEADLINE.open}**`
    : `🔴 **${LAB_HEADLINE.closed}**`

  // Said on the sign rather than left to be inferred: a lab reading CLOSED at 2am
  // looks exactly like one somebody forgot to open.
  const curfew = state.buildingOpen ? '' : `\n${BUILDING_HOURS_SENTENCE}`

  if (!state.changedAt) return headline + curfew

  const verb = state.open ? 'Opened' : 'Closed'
  const when = `<t:${Math.floor(state.changedAt.getTime() / 1_000)}:R>`

  const line = state.changedBy
    ? `${verb} by ${state.changedBy} · ${when}`
    : `${verb} ${when}`

  return `${headline}\n${line}${curfew}`
}

/**
 * Reading the sign back — the half that makes Discord the record.
 *
 * Matched on the headline text, not the emoji: an emoji is one codepoint away
 * from a look-alike and it's the part somebody copying by hand gets wrong. Null
 * for a message carrying neither, which this feature didn't write.
 */
export function signSays(content: string): boolean | null {
  if (content.includes(LAB_HEADLINE.open)) return true
  if (content.includes(LAB_HEADLINE.closed)) return false
  return null
}

/**
 * The one button under the sign, as the two facts about it that matter: which
 * state a press asks for, and whether it can be pressed at all.
 *
 * Split out from the row it goes in because the reconcile compares the sign's
 * button against this and nothing else. Reading back a label or a colour would be
 * comparing the sign to its own decoration; these two are what a press does.
 *
 * Null when nothing should be attached: a dead button answers "This interaction
 * failed" in front of the whole club, so `buttonsLive` — the key and a confirmed
 * interactions endpoint — rather than the key alone.
 */
function labButton(
  state: LabState,
): { customId: string; disabled: boolean } | null {
  if (!buttonsLive()) return null

  return {
    // A single button for the opposite state rather than a pair — the sign is a
    // toggle, and OPEN beside CLOSE is two controls for one fact, one of which is
    // always a no-op. The id names the target state anyway, so a press on a
    // message not yet edited asks for what the presser meant.
    customId: state.open ? LAB_BUTTON.close : LAB_BUTTON.open,
    // Greyed rather than dropped overnight, like the dashboard's switch: the
    // control is still theirs, it just has nothing to act on until eight. A press
    // gets the same sentence back privately anyway, since a stale message can
    // still carry a live button.
    //
    // This is the one part of the sign that changes on the clock rather than on a
    // press, so it is also the part that goes stale on its own — `signAgrees` in
    // the reconcile is what puts it back at eight in the morning.
    disabled: !state.open && !state.buildingOpen,
  }
}

/**
 * That button in the shape Discord wants it, so an officer already in Discord
 * never has to open the site.
 */
export function labButtons(state: LabState): MessageComponents {
  const button = labButton(state)
  if (!button) return []

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          // 3 is Discord's green and 4 its red, the same two colours as the dot
          // on the site. Opening is the affirmative press, closing the
          // destructive one, which is the dashboard's convention too.
          style: state.open ? 4 : 3,
          label: state.open ? 'Close the lab' : 'Open the lab',
          custom_id: button.customId,
          disabled: button.disabled,
        },
      ],
    },
  ]
}

/**
 * The lab as it stands. A row that has never been written reads as closed, and
 * that direction is deliberate: wrong the other way costs somebody a walk across
 * campus to a locked door.
 */
export async function readLabStatus(now: Date = new Date()): Promise<LabState> {
  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: rowSelect,
  })

  // Masked here as well as written by the sweep — this is the half that makes the
  // site right at 22:00:01 rather than within ten minutes.
  return row
    ? stateOf(row, now)
    : {
        open: false,
        changedAt: null,
        changedBy: null,
        buildingOpen: buildingOpen(now),
      }
}

/**
 * Everything that touches the sign runs one at a time.
 *
 * Two presses a second apart would otherwise interleave a rename and an edit, or
 * both find no message and post one each. Chaining also means the later press
 * wins, which is what anybody would expect.
 *
 * In-process, so it holds for one API instance. At club scale there is one, and
 * `reconcileLabStatus` is the backstop for the day there are two.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialise<T>(work: () => Promise<T>): Promise<T> {
  // `then(work, work)` rather than `then(work)`: a previous job that threw must
  // not take the next one with it.
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

/**
 * Whatever work is in flight, without starting more.
 *
 * For the suite, which has to wait on the push the sweep fired and forgot.
 * Awaiting `pushLabStatus()` would flush it and enqueue a second.
 */
export const pendingLabPush = (): Promise<unknown> => queue

/**
 * What happened to a press.
 *
 * `cooldown` and `refused` both mean nothing moved, on the site or in Discord,
 * and both carry something a person can read — a press that quietly did nothing
 * is what gets pressed four more times and spends the rename budget.
 */
export type LabFlip =
  | { status: 'changed'; state: LabState }
  /** Asked for the state it is already in. A 200 and nothing else. */
  | { status: 'unchanged'; state: LabState }
  /** Discord is rate-limiting the channel name. `retryAfterMs` is its own
      number, not a guess. */
  | { status: 'cooldown'; retryAfterMs: number; state: LabState }
  /** Discord refused or could not be reached. The sign is what the club reads,
      so a sign that cannot be moved is a lab that does not move. */
  | { status: 'refused'; reason: string; state: LabState }

/**
 * Flip it — in Discord first, and in the database only if that worked.
 *
 * The order is the feature. `renameChannel` is the call that gets throttled and
 * the half of the sign people see without opening the channel, so it goes first
 * and its answer decides whether anything else happens. A `throttled` or
 * `refused` comes straight back as a sentence and the row isn't touched.
 *
 * The message is not a veto, deliberately: by then the channel is already
 * renamed, so refusing would leave the name saying one thing and the row another.
 * A message that doesn't land marks the row unsynced for the sweep.
 *
 * Setting it to what it already is does nothing. Every push spends one of the two
 * renames Discord allows per ten minutes, and re-opening an open lab would
 * re-stamp `changedAt` so the sign read as a fresh opening. The dashboard's
 * switch can't ask for it; a second tab, a double submit or a script can.
 */
export function flipLabStatus(
  open: boolean,
  by: { id: string | null; fullName: string },
  now: Date = new Date(),
): Promise<LabFlip> {
  return serialise(() => flip(open, by, now))
}

async function flip(
  open: boolean,
  by: { id: string | null; fullName: string },
  now: Date,
): Promise<LabFlip> {
  const current = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: signSelect,
  })

  if (current && current.open === open) {
    return { status: 'unchanged', state: stateOf(current, now) }
  }

  const next: LabState = {
    open,
    changedAt: now,
    // Anonymous when the presser has no account here — a Discord officer who
    // never signed up. Their name is dropped rather than written onto a sign the
    // next push would render without it.
    changedBy: by.id ? by.fullName : null,
    buildingOpen: buildingOpen(now),
  }

  let messageId = current?.discordMessageId ?? null
  let landed = true

  if (labChannelConfigured && labChannelId) {
    const renamed = await renameChannel(
      labChannelId,
      next.open ? LAB_CHANNEL_NAME.open : LAB_CHANNEL_NAME.closed,
      // `by.fullName` rather than `next.changedBy`, the one place the two differ:
      // an officer with no account here is anonymous on the sign, but the guild's
      // audit log is written once and should say who.
      `Lab ${next.open ? 'opened' : 'closed'} by ${by.fullName}`,
    )

    if (renamed.status === 'throttled') {
      // Not an error: Discord allows two of these every ten minutes and somebody
      // just used both. Logged anyway, because "the button did nothing" is
      // otherwise unexplainable from outside.
      console.log(
        `lab status: channel rename throttled, flip refused (Discord asked for ${Math.round(renamed.retryAfterMs / 1_000)}s)`,
      )

      return {
        status: 'cooldown',
        retryAfterMs: renamed.retryAfterMs,
        state: current
          ? stateOf(current, now)
          : { open: false, changedAt: null, changedBy: null, buildingOpen: next.buildingOpen },
      }
    }

    if (renamed.status !== 'done' && renamed.status !== 'unchecked') {
      return {
        status: 'refused',
        reason: renamed.reason,
        state: current
          ? stateOf(current, now)
          : { open: false, changedAt: null, changedBy: null, buildingOpen: next.buildingOpen },
      }
    }

    // Always the same edit, opening included. The club hears about it from the
    // channel name going green, not from a message arriving.
    const written = await writeSign(next, current)
    messageId = written.messageId ?? messageId
    landed = written.landed
  }

  await prisma.labStatus.upsert({
    where: { id: CURRENT },
    create: {
      id: CURRENT,
      open,
      changedAt: now,
      changedById: by.id,
      discordChannelId: labChannelId,
      discordMessageId: messageId,
      discordSynced: landed,
    },
    update: {
      open,
      changedAt: now,
      changedById: by.id,
      discordChannelId: labChannelId,
      discordMessageId: messageId,
      discordSynced: landed,
    },
  })

  return { status: 'changed', state: next }
}

/**
 * Put the sign in step with the row, without asking the row's permission.
 *
 * For writes that have already happened — the curfew's close, and the sweep
 * retrying a throttled rename. Unlike `flipLabStatus` this vetoes nothing:
 * whatever it can't get out is recorded as unsynced and tried again next tick.
 *
 * Fire-and-forget by contract; it swallows and logs its own failures, because
 * every caller has already answered somebody.
 */
export function pushLabStatus(): Promise<unknown> {
  return serialise(() =>
    push().catch((error: unknown) => {
      console.error('lab status: push failed', error)
    }),
  )
}

async function push(): Promise<void> {
  if (!labChannelConfigured || !labChannelId) return

  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: signSelect,
  })

  // Nothing has ever been set, so there's nothing to say. The channel is left as
  // the club left it rather than renamed on the strength of a row that isn't there.
  if (!row) return

  // Through the same mask the pages read, so a sign pushed at midnight cannot
  // say OPEN because the row still does.
  const state = stateOf(row, new Date())

  // The name first, for the reason `flip` renames first: it's the half that gets
  // throttled and the half people read from the sidebar. Unlike a press, a
  // throttle here doesn't stop the message being written.
  const renamed = await renameChannel(
    labChannelId,
    state.open ? LAB_CHANNEL_NAME.open : LAB_CHANNEL_NAME.closed,
    `Lab ${state.open ? 'opened' : 'closed'}${state.changedBy ? ` by ${state.changedBy}` : ''}`,
  )

  if (renamed.status === 'throttled') {
    console.log(
      `lab status: channel rename throttled, retrying on the next sweep (Discord asked for ${Math.round(renamed.retryAfterMs / 1_000)}s)`,
    )
  }

  // The same edit a press makes, which is why this can run every ten minutes for
  // as long as something is failing without anybody hearing about it.
  const written = await writeSign(state, row)
  const nameLanded = renamed.status === 'done' || renamed.status === 'unchecked'

  await prisma.labStatus.update({
    where: { id: CURRENT },
    data: {
      discordChannelId: labChannelId,
      discordMessageId: written.messageId ?? row.discordMessageId,
      discordSynced: written.landed && nameLanded,
    },
  })
}

/**
 * The message half of the sign: exactly one message in the channel, edited in
 * place for the life of the channel.
 *
 * Posting is the last resort rather than a mode. An edit notifies nobody and keeps
 * the sign where people last saw it, so the only thing that gets a new message is
 * a channel with no sign in it — a new one, a restored dump, a message somebody
 * deleted.
 *
 * Finding the existing message is three candidates, in order of trust:
 *
 *   1. The id on the row, dropped if `DISCORD_LAB_CHANNEL_ID` has been pointed
 *      elsewhere since — an edit aimed at the wrong channel 404s exactly like a
 *      message somebody deleted.
 *   2. `DISCORD_LAB_MESSAGE_ID`, which seeds a row that has never pushed. It
 *      doesn't outrank the row and can't: the row's id is the message this
 *      process has been keeping up to date, and a setting that won would point at
 *      whatever was in the channel the day somebody last edited `.env`.
 *   3. Whatever this bot has already posted there. This is what makes the rule
 *      hold across a restored dump or a row somebody reset.
 *
 * A search that fails posts nothing. "Nothing of ours is here" and "I couldn't
 * look" arrive at the same place and only the first is safe to act on.
 */
async function writeSign(
  state: LabState,
  row: StoredMessage | null,
): Promise<{ messageId: string | null; landed: boolean }> {
  if (!labChannelId) return { messageId: null, landed: false }

  const content = labMessage(state)
  const components = labButtons(state)

  const stored =
    row?.discordMessageId && row.discordChannelId === labChannelId
      ? row.discordMessageId
      : null

  const candidate = stored ?? labMessageId

  if (candidate) {
    const edit = await editChannelMessage(labChannelId, candidate, content, {
      components,
    })

    if (edit.status === 'sent') return { messageId: candidate, landed: true }

    // Anything but `gone` is worth retrying against the same id — the message is
    // still there and Discord was unreachable or unhappy. `gone` means it isn't
    // ours to edit, so fall through and look properly.
    if (edit.status !== 'gone') return { messageId: candidate, landed: false }
  }

  const existing = await findBotMessages(labChannelId)

  if (existing.status === 'found') {
    const sign = existing.messages[0]!

    const edit = await editChannelMessage(labChannelId, sign.messageId, content, {
      components,
    })

    return { messageId: sign.messageId, landed: edit.status === 'sent' }
  }

  if (existing.status !== 'none') {
    // Deliberately not a post. See the note above.
    console.error(
      `lab status: could not read channel ${labChannelId}, so nothing was posted — the sign is unchanged`,
    )
    return { messageId: null, landed: false }
  }

  const posted = await postChannelMessage(labChannelId, content, { components })

  return posted.status === 'sent'
    ? { messageId: posted.messageId, landed: true }
    : { messageId: null, landed: false }
}

/**
 * How many strays one sweep will clear.
 *
 * Discord rate-limits deletes per channel, and a channel carrying a year of old
 * announcements would walk into it. Five a tick clears a normal backlog inside an
 * hour without spending the budget another feature might need.
 */
const TIDY_PER_SWEEP = 5

/**
 * Delete every message of the bot's in the lab channel except the sign.
 *
 * This is what makes "one message" an invariant rather than an intention: an
 * earlier design posted a fresh sign every opening and deleted the one before it,
 * so a failed delete left a message behind, and two instances can both have
 * posted into an empty channel. Nothing that edits heals either.
 *
 * Bounded three ways, because it's the only destructive thing here: only messages
 * Discord says this bot posted, only in `DISCORD_LAB_CHANNEL_ID`, and never the
 * sign. A `messages` list it couldn't read deletes nothing.
 */
async function tidyChannel(
  messages: BotMessage[],
  keep: string,
): Promise<void> {
  if (!labChannelId) return

  const strays = messages.filter((message) => message.messageId !== keep)
  if (strays.length === 0) return

  const batch = strays.slice(0, TIDY_PER_SWEEP)

  console.log(
    `lab status: clearing ${batch.length} old sign${batch.length === 1 ? '' : 's'} out of the lab channel${
      strays.length > batch.length
        ? ` (${strays.length - batch.length} more on the next sweep)`
        : ''
    }`,
  )

  for (const stray of batch) {
    await deleteChannelMessage(labChannelId, stray.messageId)
  }

  // Nothing is returned or recorded, deliberately. A stray left behind must not
  // mark the row unsynced: that would push a rename every tick until the backlog
  // cleared, spending the two-per-ten-minutes budget on a correct name. The next
  // tick tidies again regardless.
}

/** What the reconcile did, for the log and the suite. */
export interface LabReconcile {
  /** The row was corrected to match what Discord says. */
  adopted: boolean
  /** Discord and the row already agreed, or Discord could not be read. */
  open: boolean | null
}

/**
 * Read the sign back and make the row match it.
 *
 * The half that makes Discord the record: everything else writes towards Discord,
 * this is the only thing that reads from it. It closes the gap left by a message
 * edited by hand, a write lost between the rename and the row, or a second
 * instance that flipped it. Ten minutes late, but agreeing.
 *
 * Two things it won't adopt, and both are the building rather than the sync: open
 * overnight, because the curfew wins over anything a channel says; and a message
 * that says neither, which this feature didn't write.
 *
 * Not serialised on the queue and doesn't need to be — it only reads Discord, and
 * a flip landing between the read and the write wins, which is the right way
 * round: a press is newer than a ten-minute-old sign.
 */
export async function reconcileLabStatus(
  now: Date = new Date(),
): Promise<LabReconcile> {
  if (!labChannelConfigured || !labChannelId) return { adopted: false, open: null }

  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: signSelect,
  })

  // The same order `writeSign` uses, and it has to be: reading one message back
  // and editing another adopts the wrong sign every tick.
  const stored =
    (row?.discordMessageId && row.discordChannelId === labChannelId
      ? row.discordMessageId
      : null) ?? labMessageId

  // One listing rather than a fetch of the stored id, because this call has a
  // second job — what it returns besides the sign is the set of strays.
  const existing = await findBotMessages(labChannelId)
  if (existing.status !== 'found') return { adopted: false, open: null }

  const known = existing.messages.find(
    (candidate) => candidate.messageId === stored,
  )

  /**
   * Only the message the row knows about may change what the lab is, and this
   * guard is the most important line in the function.
   *
   * A leftover from an older design saying THE LAB IS CLOSED is indistinguishable
   * from a sign somebody just edited, so without this a stray silently closes the
   * lab for the whole club. That has happened, against the real guild.
   *
   * So a message found by search is adopted as the sign — its id is learned and
   * it's what gets edited from here on — but its state is not read. The row's
   * answer is pushed onto it instead.
   */
  const message = known ?? existing.messages[0]!

  if (!known) {
    // Not `adopted`, because nothing was: the id is learned and the sign will
    // be overwritten with the row's state on the push this marks as due.
    console.log(
      `lab status: the sign is ${message.messageId}, which the row did not know about — keeping the site's own state and pushing it`,
    )

    /**
     * `upsert`, because on a fresh database there is no row to update.
     *
     * This threw on the club's first deployment, every ten minutes. Nothing
     * creates the `lab_status` row — not the migration, not the seed, not the
     * legacy import. It appears on the first flip, or in the `!row` branch below,
     * which sits after this early return. So a fresh database that already has a
     * sign in the channel — every real deployment, since the channel outlives the
     * database — lands here, finds no row, and raises P2025 for ever.
     *
     * The create side says closed, and not because closed is likelier: the guard
     * above ignores a found message's state, and with no row there's no site state
     * either, so the one answer that can't hurt anybody is closed. Wrongly OPEN
     * sends somebody to a locked door; wrongly CLOSED costs them a question.
     * `discordSynced: false` marks the correcting push as due.
     */
    await prisma.labStatus.upsert({
      where: { id: CURRENT },
      update: {
        discordChannelId: labChannelId,
        discordMessageId: message.messageId,
        discordSynced: false,
      },
      create: {
        id: CURRENT,
        open: false,
        changedAt: now,
        // Nobody here did this, the same reasoning as the adopt below.
        changedById: null,
        discordChannelId: labChannelId,
        discordMessageId: message.messageId,
        discordSynced: false,
      },
    })

    return { adopted: false, open: null }
  }

  const says = signSays(message.content)
  if (says === null) return { adopted: false, open: null }

  // Everything of ours that isn't the sign, gone. Awaited deliberately: a tick
  // that adopted a state and left four old announcements above it has done the
  // visible half and skipped the one somebody complained about.
  //
  // Under the guard above, and only under it. Deleting is irreversible, and
  // "which of these is the sign" was just answered by the row rather than guessed
  // at — a tidy run on a guess deletes the club's real announcement.
  await tidyChannel(existing.messages, message.messageId)

  // A sign saying OPEN overnight isn't adopted: the row is left closed and the
  // push corrects the message. Worked out before the name is checked, because
  // it's what the name is checked against — the question is whether the whole
  // sign matches what the lab is about to be.
  const adoptable = says && !buildingOpen(now) ? false : says

  // The name is the other half of the sign and the half that drifts, since a
  // rename is what Discord throttles hardest. Checked rather than trusted, so a
  // name left behind by a throttled push is noticed on the tick, not at the next
  // flip.
  const expected = adoptable ? LAB_CHANNEL_NAME.open : LAB_CHANNEL_NAME.closed
  const name = await readChannelName(labChannelId)
  const nameAgrees = name.status !== 'found' || name.name === expected

  /**
   * The sign as it should read this minute, to compare what is in the channel
   * against. `changedAt` and `changedBy` are left out because nothing below reads
   * them: they write the line under the headline, which is the row's own and
   * cannot drift from it.
   */
  const wanted: LabState = {
    open: adoptable,
    changedAt: null,
    changedBy: null,
    buildingOpen: buildingOpen(now),
  }

  /**
   * Whether the sign carries the button it should — there at all, asking for the
   * right state, and pressable or not as the hour says.
   *
   * Two gaps, and the second is why this compares the button rather than counting
   * them. A club that fills in `DISCORD_PUBLIC_KEY` and restarts has a sign whose
   * words are already correct, so without this nothing would push and no buttons
   * would appear until somebody flipped the lab — which reads as the key not
   * working. And the button is greyed out overnight, which is a fact about the
   * hour rather than about the lab: at eight in the morning the row still says
   * closed and the sign still says CLOSED, so a check that only compared those
   * left a dead Open button up at exactly the hour somebody wants to press it,
   * until the next flip — which they were using the button to make.
   */
  const wantedButton = labButton(wanted)

  const buttonsAgree =
    message.buttons.length === (wantedButton ? 1 : 0) &&
    message.buttons.every(
      (button) =>
        button.customId === wantedButton?.customId &&
        button.disabled === wantedButton?.disabled,
    )

  /**
   * And whether the words match the hour too. The curfew sentence is written by
   * the clock in the same breath as the greyed button, so it goes stale in the
   * same way: left alone, the sign tells the club the building is shut until
   * somebody flips the lab in the afternoon.
   */
  const hoursAgree =
    message.content.includes(BUILDING_HOURS_SENTENCE) === !wanted.buildingOpen

  /**
   * Whether the sign already says what the row is about to say — all of it.
   *
   * `adoptable !== says` is the curfew having overruled the message, and it has to
   * force a push on its own. Otherwise a message edited by hand to OPEN at two in
   * the morning, in a channel somebody also renamed green, agrees with itself
   * perfectly and would sit there all night.
   */
  const signAgrees =
    nameAgrees && buttonsAgree && hoursAgree && adoptable === says

  if (!row) {
    // No row at all and a sign in the channel: adopt it, attributed to nobody,
    // because nobody here pressed anything.
    await prisma.labStatus.create({
      data: {
        id: CURRENT,
        open: adoptable,
        changedAt: now,
        changedById: null,
        discordChannelId: labChannelId,
        discordMessageId: message.messageId,
        discordSynced: signAgrees,
      },
    })

    return { adopted: true, open: says }
  }

  // The id is worth writing back on its own: a message found by search is one the
  // row didn't know about, and knowing it saves a listing on every push from here.
  const learned =
    row.discordMessageId !== message.messageId ||
    row.discordChannelId !== labChannelId

  if (row.open === adoptable) {
    if (learned || !signAgrees) {
      await prisma.labStatus.update({
        where: { id: CURRENT },
        data: {
          discordChannelId: labChannelId,
          discordMessageId: message.messageId,
          // A sign that disagrees is a push waiting to happen, whatever the
          // last one thought it had landed.
          ...(signAgrees ? {} : { discordSynced: false }),
        },
      })
    }

    return { adopted: false, open: says }
  }

  await prisma.labStatus.update({
    where: { id: CURRENT },
    data: {
      open: adoptable,
      changedAt: now,
      // Nobody here did this. Attributing a message somebody edited in Discord to
      // whoever last used the dashboard puts their name on someone else's decision.
      changedById: null,
      discordChannelId: labChannelId,
      discordMessageId: message.messageId,
      discordSynced: signAgrees,
    },
  })

  console.log(
    adoptable === says
      ? `lab status: adopted Discord's sign — the lab reads ${says ? 'OPEN' : 'CLOSED'}`
      : 'lab status: the sign says OPEN and the building is shut, so the lab was closed and the sign will be corrected',
  )

  return { adopted: adoptable === says, open: says }
}

/**
 * The ten-minute tick: lock up if the building has shut, read the sign back, and
 * retry whatever the last push couldn't get out.
 *
 * Cheap when there's nothing to do — one indexed read and, if Discord is
 * configured, two calls to read the sign. Which is most ticks of most days.
 */
export async function sweepLabStatus(
  now: Date = new Date(),
): Promise<{ closed: boolean; adopted: boolean; retried: boolean }> {
  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: { open: true, discordSynced: true },
  })

  /**
   * Locking up on the club's behalf, checked before anything touching Discord
   * because it changes what those calls would say.
   *
   * Not conditional on Discord being configured, either: whether the lab is open
   * is a fact about the site, and a club with no bot still gets an honest front
   * page. The `labChannelConfigured` guard belongs to the sign, so it sits under
   * this rather than over it.
   *
   * And it isn't vetoed by a throttled rename, unlike a press — a green sign over
   * a locked building all night isn't worth protecting the rename budget for.
   */
  if (row?.open && !buildingOpen(now)) {
    await prisma.labStatus.update({
      where: { id: CURRENT },
      data: {
        open: false,
        changedAt: now,
        // Nobody closed it. Attributing this to whoever opened the lab at six
        // would put their name on someone else's decision — and "Closed 3 minutes
        // ago" beside "the building is shut until 8am" says what happened anyway.
        changedById: null,
        discordSynced: false,
      },
    })

    await pushLabStatus()
    return { closed: true, adopted: false, retried: false }
  }

  if (!labChannelConfigured) return { closed: false, adopted: false, retried: false }

  // Discord is the record, so it's read before anything is pushed at it — a retry
  // that went first would overwrite the message it's meant to reconcile against.
  const reconciled = await reconcileLabStatus(now)

  const after = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: { discordSynced: true },
  })

  if (!after || after.discordSynced) {
    return { closed: false, adopted: reconciled.adopted, retried: false }
  }

  await pushLabStatus()
  return { closed: false, adopted: reconciled.adopted, retried: true }
}
