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
  memberRoleId,
  postChannelMessage,
  readChannelName,
  renameChannel,
} from '../discord/discord.js'

/**
 * Whether the lab is open, and the sign in Discord that says so.
 *
 * One boolean, one row, and three places it has to show up: the landing page,
 * the dashboard an officer flips it from, and a Discord channel that carries
 * both a message and a colour in its own name.
 *
 * ## Discord is the record, and the row follows it
 *
 * This is the direction of the whole file and it is the opposite of how the
 * feature started. The club reads the lab sign in Discord — that is the room
 * people are already in — so **the message in that channel is what the lab is**,
 * and `lab_status` is the site's copy of it.
 *
 * Two things fall out of that, and they are the two rules everything below is
 * arranged around:
 *
 *   - **A flip that Discord will not take does not happen.** `flipLabStatus`
 *     renames the channel *first* and writes the row only if that landed. A
 *     throttled rename comes back as a cooldown the presser is told about, and
 *     the lab is left exactly as it was. The old shape wrote the row and let
 *     Discord catch up, which meant a throttled rename left the site saying OPEN
 *     over a channel that still read `lab-status-🔴` for up to ten minutes —
 *     and people believe the channel.
 *   - **The sweep reads Discord back.** `reconcileLabStatus` fetches the message
 *     every ten minutes and, if it disagrees with the row, corrects *the row*. A
 *     message edited by hand, a write this process lost, a second instance that
 *     flipped it — all of them end with the site agreeing with the channel.
 *
 * **"Discord" means the sign, and only the sign.** State is read back from the
 * one message the row knows it is keeping — never from whatever else the bot
 * has left in the channel. A leftover from an older design reading THE LAB IS
 * CLOSED is indistinguishable from a sign somebody just corrected, so a
 * reconcile that trusted any message would let a stray close the lab for the
 * whole club. It did, once, against the real guild; `reconcileLabStatus` carries
 * the guard and the story.
 *
 * The one thing that overrides Discord is the building's own hours, below. That
 * is not a sync direction; it is a fact about a locked door.
 *
 * ## Exactly one message in the channel, and it still pings
 *
 * Two requirements that look like they cannot both hold. **Posting a message
 * notifies people and editing one never does**, whatever the content changes
 * into — so a sign kept up to date for ever reaches nobody, and a sign that
 * posts every evening fills a channel until people mute it, at which point it
 * has made things worse than having none.
 *
 * The way through is **post new, then delete old**. Opening the lab posts a
 * fresh message — that post is the `@Members` ping — and the message it
 * replaces is deleted immediately after. The channel still holds exactly one
 * sign; it is simply not the same one from week to week.
 *
 * The two verbs split along what each is for:
 *
 *   - **Opening posts**, because opening is the only thing here worth
 *     interrupting anybody for.
 *   - **Everything else edits**: closing, the curfew, a sweep retry. Closing
 *     deliberately does not post, and not only to save a message — a *new*
 *     message marks the channel unread for the whole club, and "the lab shut
 *     twenty seconds ago" is an interruption nobody can act on. The message
 *     going grey and the channel's name turning red are what say it.
 *
 * A post is otherwise the last resort and it is guarded on both sides. The id
 * is taken from the row, or from `DISCORD_LAB_MESSAGE_ID` on a row that has
 * never pushed one; if neither is good, the channel itself is searched for a
 * message this bot posted, and **only a channel with nothing of ours in it gets
 * a new one**. A search that *fails* — no Read Message History, Discord
 * unreachable — posts nothing at all, because "I could not look" and "there is
 * nothing there" are the same answer to a caller and only one of them is safe
 * to act on.
 *
 * **`tidyChannel` on the sweep is what makes the invariant hold rather than
 * merely being intended.** The delete after a post can fail, an older design
 * can have left messages behind, two instances can both have posted — so every
 * ten minutes the channel is listed and every message of the bot's that is not
 * the sign is removed. It is the only destructive thing this file does, it only
 * ever touches messages Discord says the bot itself posted, and it only ever
 * touches the lab channel.
 *
 * **Nothing re-announces.** Whether a post goes out is a property of the flip —
 * "the lab is being opened, right now, by somebody" — and never of the row. A
 * sweep retrying a push that failed edits whatever is there rather than posting
 * a second announcement, so the club is never pinged twice for one evening. The
 * cost is the opposite failure: if the *post itself* fails, the sign is put
 * right by an edit and that opening's ping is simply lost. That direction is
 * the deliberate one — a missed notification is a shame, and a channel pinged
 * every ten minutes until a rename stops being throttled is why people mute
 * things.
 *
 * ## The building shuts at ten
 *
 * Between 22:00 and 08:00 **Orlando time** there is no lab to be in, so the
 * switch is refused and the sign reads closed whatever the row or the channel
 * says. Two mechanisms, and both are needed:
 *
 *   - **`readLabStatus` masks.** The answer is derived from the clock at read
 *     time, so the site is never wrong for even a second — 22:00:01 reads
 *     closed on the very next request.
 *   - **The sweep writes.** Masking alone would leave the row saying open, the
 *     Discord channel green and the message stale until somebody pressed
 *     something. The ten-minute tick closes it properly, which pushes the sign
 *     and puts a real `changed_at` on the record.
 *
 * **The curfew is the one write that does not need Discord's permission.** A
 * throttled rename cannot be allowed to leave a green sign over a locked
 * building all night, so the close is committed regardless and the row is
 * marked unsynced for the sweep to push. That is the difference between a rule
 * and a press: an officer's press is a request, and ten at night is not.
 *
 * **Nothing re-opens at eight.** The curfew can only ever close: a lab that
 * sprang open at 08:00 because it had been open at 21:59 would be a sign
 * nobody made, on a room nobody is in.
 *
 * ## Two renames per ten minutes
 *
 * Discord rate-limits a channel *name* far harder than anything else here —
 * two changes per ten minutes, per channel — and a toggle button is exactly the
 * control somebody presses three times in a minute while working out whether
 * they meant it. The third rename comes back 429 with a `retry_after` measured
 * in minutes.
 *
 * That limit is why the cooldown is a *sentence somebody reads* rather than
 * something retried behind their back. Five minutes is not a wait to hold a
 * request open for, and a press that silently did nothing is the worst of the
 * three outcomes. Both callers say so out loud: the dashboard gets a 429 with
 * the wait in it, and a button press gets a private note in Discord.
 */

/** The one row. See `LabStatus` in `schema.prisma` for why it has a fixed id. */
const CURRENT = 'current'

/**
 * The club is at UCF, so "ten at night" is ten at night **in Orlando** — not in
 * UTC, where the server's clock runs, and not in the reader's zone, where the
 * browser's does. A wall-clock hour is not an offset from an instant: Florida
 * moves by an hour twice a year, so `getHours() - 4` is right for eight months
 * and wrong for four.
 *
 * `Intl` is what knows the rule and it is in Node and every browser, so there
 * is no library here and no stored offset to go stale.
 */
export const CAMPUS_ZONE = 'America/New_York'

/**
 * When the physical building is open, as hours on a 24-hour clock.
 *
 * Constants rather than configuration, for the same reason `LAB_CHANNEL_NAME`
 * is: these are what the feature *is*. If the building's hours ever genuinely
 * change they are one edit here, and `web/src/lib/lab/lab.ts` — which prints them
 * on the dashboard — carries a note pointing at this pair.
 */
export const BUILDING_OPENS_AT = 8
export const BUILDING_CLOSES_AT = 22

/**
 * `hourCycle: 'h23'` and not `hour12: false`, which is the trap. The two look
 * equivalent and differ at exactly one hour of the day: with `hour12: false`
 * some ICU builds render midnight as **24**, so a naive `hour < 22` check
 * would call one hour a night "open" on some machines and not others.
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
 * Whether the building somebody would be walking to is open at all.
 *
 * The lab cannot be open when this is false, whatever the row says, whatever
 * the channel says and whoever pressed what — which is the point: an officer
 * who forgets to close up at midnight should not leave a green sign on the
 * front page all night.
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
 * One sentence for both callers — the dashboard's 429 body and the private note
 * a button press gets back — because they are the same fact and two wordings of
 * it would drift. Three things it has to do, and each of them was a way this
 * failed before:
 *
 *   - **Say the lab did not change.** A press that appeared to do nothing is
 *     what gets pressed four more times, which is what spent the budget.
 *   - **Say whose limit it is.** "Rate limited" reads as the site being broken.
 *     It is Discord's rule about a channel *name*, and it is a strange enough
 *     rule to be worth naming.
 *   - **Give the wait in the units it is actually in.** Discord answers in
 *     minutes for a rename, so "try again in 300 seconds" is arithmetic
 *     somebody has to do while holding a door open.
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
 * Written here rather than configured, unlike the channel id. The id is the
 * club's — it changes if somebody makes a new channel — while the shape of the
 * name is what this feature *is*, and two more environment variables to say
 * "red when shut" would be settings nobody ever changes and one more way to get
 * a half-configured sign.
 *
 * Discord lowercases a channel name and turns spaces into hyphens on the way
 * in, so these are already written the way they will come back out. The emoji
 * survives.
 */
export const LAB_CHANNEL_NAME = {
  open: 'lab-status-🟢',
  closed: 'lab-status-🔴',
} as const

/**
 * The two headlines, as the strings the sign is both *written with* and *read
 * back out of*.
 *
 * Constants rather than two literals in two functions, because the reconcile
 * decides what the lab is by looking for one of them in a message the bot
 * posted possibly months ago. Change the wording in one place and forget the
 * other and the site stops being able to read its own sign — which fails
 * silently, as a reconcile that never adopts anything.
 */
export const LAB_HEADLINE = {
  open: 'THE LAB IS OPEN',
  closed: 'THE LAB IS CLOSED',
} as const

/**
 * The `custom_id` on each button, and the only thing that comes back from a
 * press to say which one it was.
 *
 * Namespaced `lab:` because an application has one interactions endpoint for
 * everything it will ever offer, and the second feature to grow a button is the
 * one that discovers a bare `open` was ambiguous.
 */
export const LAB_BUTTON = {
  open: 'lab:open',
  close: 'lab:close',
} as const

/** The lab as the site knows it. `changedAt` is null when nobody has ever set
    it — which is not the same as "closed a long time ago", and the pages say
    so differently. */
export interface LabState {
  /**
   * **Already masked by the building's hours.** Never `row.open` on its own:
   * every caller wants the answer somebody would act on, and there is no caller
   * that wants "an officer left it open and then the building shut at ten".
   */
  open: boolean
  changedAt: Date | null
  /** Who flipped it, by name. Null for a row nobody has touched, null again if
      that account has since been deleted — `changedById` is `SetNull` — null
      for a close the curfew did rather than a person, and null for a button
      pressed by somebody with no account on the site. */
  changedBy: string | null
  /** Whether the building is open at all. What tells "nobody has opened it"
      from "nobody can", which are different sentences on both pages and the
      difference between a switch that is off and one that is disabled. */
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
 * The row plus the clock, in one place, because several callers derive this and
 * a second copy of the mask is where it eventually gets left out of one.
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
 * ago" in their own client, and it keeps counting without the message being
 * edited again. That is the whole reason the time is rendered this way rather
 * than as a formatted string — a status message edited in place would otherwise
 * need re-editing every few minutes to stay honest, and each edit is another
 * write against a channel this file is already careful with.
 *
 * **The mention rides on the open headline and nowhere else.** It is only ever
 * *delivered* by a fresh post — an edit that carries one reaches nobody — so on
 * the closed sign it would be a mention that looks like a notification somebody
 * missed. `memberRoleId` unset is a club that has not configured the Members
 * role at all, and then there is simply nobody to address; the new message
 * still goes out, and the unread mark on the channel is the signal.
 *
 * Exported for the tests, which assert on the two states rather than on
 * whatever Discord happened to accept.
 */
export function labMessage(state: LabState): string {
  const ping = state.open && memberRoleId ? ` <@&${memberRoleId}>` : ''

  const headline = state.open
    ? `🟢 **${LAB_HEADLINE.open}**${ping}`
    : `🔴 **${LAB_HEADLINE.closed}**`

  // Said on the sign rather than left to be inferred. A lab reading CLOSED at
  // 2am looks exactly like one somebody forgot to open, and the reader walks
  // over to find out.
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
 * Reading the sign back — the half that makes Discord the record rather than a
 * projection of it.
 *
 * Matched on the headline text alone, not on the emoji: an emoji is one
 * codepoint away from a look-alike and it is the part of the message somebody
 * copying it by hand gets wrong. Null for a message that carries neither, which
 * is a message this feature did not write and must not be read as either state.
 */
export function signSays(content: string): boolean | null {
  if (content.includes(LAB_HEADLINE.open)) return true
  if (content.includes(LAB_HEADLINE.closed)) return false
  return null
}

/**
 * The one button under the sign, so an officer already in Discord never has to
 * open the site.
 *
 * A single button for the *opposite* state rather than a pair, because the sign
 * is a toggle and a row offering OPEN beside CLOSE is two controls for one fact
 * — one of which is always a no-op. The `custom_id` names the target state all
 * the same, so a press on a message that has not been edited yet asks for what
 * the presser meant rather than for "the other one".
 *
 * **Nothing is attached at all unless a press would actually land.** A button
 * whose press goes nowhere answers "This interaction failed" in front of the
 * whole club, which is worse than a sign with no button on it — so this asks
 * `buttonsLive`, which is the key *and* an Interactions Endpoint URL confirmed
 * against Discord at startup, rather than the key alone. Having one of the two
 * is the ordinary half-configured state, not an exotic one.
 */
export function labButtons(state: LabState): MessageComponents {
  if (!buttonsLive()) return []

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          // 3 is Discord's green and 4 its red, and they are the same two
          // colours as the dot on the site. Opening is the affirmative press
          // and closing is the destructive one, which is the convention the
          // dashboard's gold/outline pair follows too.
          style: state.open ? 4 : 3,
          label: state.open ? 'Close the lab' : 'Open the lab',
          custom_id: state.open ? LAB_BUTTON.close : LAB_BUTTON.open,
          // Greyed rather than dropped overnight, for the reason the
          // dashboard's switch is: the control is still theirs, it simply has
          // nothing to act on until eight. A press gets the same sentence back
          // privately anyway, because a stale message can still carry a live
          // button.
          disabled: !state.open && !state.buildingOpen,
        },
      ],
    },
  ]
}

/**
 * The lab as it stands. A row that has never been written reads as **closed**,
 * and that direction is deliberate: being wrong the other way costs somebody a
 * walk across campus to a locked door.
 */
export async function readLabStatus(now: Date = new Date()): Promise<LabState> {
  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: rowSelect,
  })

  // Masked here as well as written by the sweep, and this is the half that
  // makes the site right at 22:00:01 rather than at some point in the next ten
  // minutes. See the note at the top of this file.
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
 * Two presses a second apart would otherwise interleave a rename and an edit,
 * and — worse — could both find no message and post one each, which is the one
 * outcome the single-message rule exists to prevent. Chaining also means the
 * later press wins, which is the answer anybody would expect.
 *
 * This is in-process, so it holds for one API instance and not across several.
 * At club scale there is one, and `reconcileLabStatus` is the backstop for the
 * day there are two: whatever Discord ended up saying is what the row is
 * corrected to on the next tick.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialise<T>(work: () => Promise<T>): Promise<T> {
  // `then(work, work)` rather than `then(work)`: a previous job that threw must
  // not take the next one with it, and a queue that only advances on success is
  // a queue one failure stops for ever.
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

/**
 * Whatever work is in flight, without starting more.
 *
 * For the suite, which has to wait on the push the sweep fired and forgot.
 * Awaiting `pushLabStatus()` instead would flush it *and* enqueue a second,
 * which is the difference between asserting Discord was written to once and
 * asserting it twice.
 */
export const pendingLabPush = (): Promise<unknown> => queue

/**
 * What happened to a press.
 *
 * `cooldown` and `refused` both mean **nothing moved** — not on the site and
 * not in Discord — and both carry something a person can read. That is the
 * whole reason this is a four-way answer rather than a boolean: a press that
 * quietly did nothing is the outcome that gets an officer to press it four more
 * times, which is what spent the rename budget in the first place.
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
 * Flip it — **in Discord first, and in the database only if that worked.**
 *
 * The order is the feature. `renameChannel` is the call that gets throttled and
 * it is also the half of the sign somebody sees without opening the channel, so
 * it goes first and its answer decides whether anything else happens at all. A
 * `throttled` or a `refused` comes straight back out as a sentence for whoever
 * pressed, and the row is not touched.
 *
 * The *message* is not a veto, and the asymmetry is deliberate: by the time it
 * is written the channel has already been renamed, so refusing at that point
 * would leave the name saying one thing and the row another — exactly the split
 * this is meant to close. A message that does not land marks the row unsynced
 * and the sweep edits it within ten minutes.
 *
 * **Setting it to what it already is does nothing at all.** Not a
 * micro-optimisation: every push spends one of the two renames Discord allows
 * per ten minutes, and re-opening an already-open lab would re-stamp
 * `changedAt` so the sign read as a fresh opening. The dashboard's switch
 * cannot ask for it, since its label follows the state; a second tab, a double
 * submit, a stale Discord message or a script can.
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
    // never signed up. Their name is dropped rather than written onto a sign
    // the next push would render without it, since everything after this reads
    // the name back through the `changedById` relation.
    changedBy: by.id ? by.fullName : null,
    buildingOpen: buildingOpen(now),
  }

  let messageId = current?.discordMessageId ?? null
  let landed = true

  if (labChannelConfigured && labChannelId) {
    const renamed = await renameChannel(
      labChannelId,
      next.open ? LAB_CHANNEL_NAME.open : LAB_CHANNEL_NAME.closed,
      // `by.fullName` rather than `next.changedBy`, and this is the one place
      // the two differ: an officer with no account here is anonymous on the
      // sign, because nothing could render their name again on the next push —
      // but the guild's own audit log is written once and should say who.
      `Lab ${next.open ? 'opened' : 'closed'} by ${by.fullName}`,
    )

    if (renamed.status === 'throttled') {
      // Not an error and not worth a stack trace: Discord allows two of these
      // every ten minutes and somebody has just used both. Logged anyway,
      // because "the button did nothing" is otherwise unexplainable from the
      // outside.
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

    // **The one place anything announces.** Opening the lab is a person doing
    // something, right now, that the club wants to hear about — so it posts,
    // and the message it replaces is deleted behind it. Nothing else here, and
    // nothing on the sweep, is allowed to post: a retry that re-announced would
    // ping the club again for an evening they were told about ten minutes ago.
    const written = await writeSign(next, current, { announce: open })
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
 * The path for writes that have already happened — the curfew's close, and the
 * sweep retrying a rename that was throttled. Unlike `flipLabStatus` this does
 * not veto anything: whatever it cannot get out is recorded as unsynced and
 * tried again on the next tick.
 *
 * Fire-and-forget by contract. It swallows and logs its own failures, because
 * every caller is something that has already answered somebody.
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

  // Nothing has ever been set, so there is nothing to say. The channel is left
  // exactly as the club left it rather than being renamed to `🔴` on the
  // strength of a row that does not exist.
  if (!row) return

  // Through the same mask the pages read, so a sign pushed at midnight cannot
  // say OPEN because the row still does.
  const state = stateOf(row, new Date())

  // The name first, for the same reason `flip` renames first: it is the half
  // that gets throttled and the half people read from the sidebar. Unlike a
  // press, a throttle here does not stop the message being written — the row is
  // already what it is, and the message is the half that can say who and when.
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

  // Never announces. See the note at the top of the file: whether the club is
  // pinged is decided by the press, not by the row, and this runs on a ten
  // minute tick for as long as something is failing.
  const written = await writeSign(state, row, { announce: false })
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
 * The message half of the sign: exactly one message in the channel.
 *
 * Two shapes, and which one runs is `announce`:
 *
 *   - **Announcing** — the lab is being opened. A *new* message is posted,
 *     because that post is the only thing Discord will notify anybody about,
 *     and the message it replaces is deleted immediately after. One in, one
 *     out.
 *   - **Otherwise** — closing, the curfew, a sweep retry. The existing message
 *     is edited in place. No ping, and no unread mark on the channel for
 *     something nobody can act on.
 *
 * Finding the existing message is three candidates in order of how much they
 * are trusted, and the order is what keeps the channel from filling up:
 *
 *   1. The id on the row. Only good for the channel it was posted in, so it is
 *      dropped outright if `DISCORD_LAB_CHANNEL_ID` has been pointed elsewhere
 *      since — an edit aimed at the wrong channel is a 404 that reads exactly
 *      like a message somebody deleted.
 *   2. `DISCORD_LAB_MESSAGE_ID`, which seeds a row that has never pushed. It
 *      does **not** outrank the row, and under post-new-then-delete it cannot:
 *      the id changes every time the lab opens, so a setting that won would be
 *      pointing at a message this file had itself deleted, and every push would
 *      spend a 404 finding that out.
 *   3. Whatever this bot has already posted in that channel. This is the one
 *      that makes the rule hold across a restored dump or a row somebody reset:
 *      without it the next push would post a second sign and the channel would
 *      collect one per incident.
 *
 * **A search that fails posts nothing.** "There is nothing of ours here" and "I
 * could not look" arrive at the same place and only the first is safe to act
 * on; treating a missing Read Message History as an empty channel is how a
 * channel ends up with forty signs in it.
 */
async function writeSign(
  state: LabState,
  row: StoredMessage | null,
  { announce }: { announce: boolean },
): Promise<{ messageId: string | null; landed: boolean }> {
  if (!labChannelId) return { messageId: null, landed: false }

  const content = labMessage(state)
  const components = labButtons(state)

  const stored =
    row?.discordMessageId && row.discordChannelId === labChannelId
      ? row.discordMessageId
      : null

  const candidate = stored ?? labMessageId

  if (announce) {
    const posted = await postChannelMessage(labChannelId, content, {
      // Said out loud rather than left to Discord's default parsing, which
      // would let anything that ended up in the body become a mention.
      mentionRoles: memberRoleId ? [memberRoleId] : [],
      components,
    })

    if (posted.status === 'sent') {
      // The other half of the trade, and it runs before this returns rather
      // than behind it: the whole point of posting was to leave one message in
      // the channel, and a delete deferred to a background task is a delete
      // nobody notices failing. `tidyChannel` on the sweep is the backstop, not
      // the mechanism.
      const removed = candidate
        ? await deleteChannelMessage(labChannelId, candidate)
        : { status: 'done' as const }

      return {
        messageId: posted.messageId,
        // `gone` counts: the old message not being there is the outcome that
        // was being asked for.
        landed: removed.status === 'done' || removed.status === 'gone',
      }
    }

    // The post failed, so there is no ping and there was never going to be
    // one. Fall through and edit instead: an evening nobody was told about is
    // a shame, and a sign that says CLOSED over an open lab is worse.
    console.error(
      'lab status: could not post the announcement, so the sign was edited instead — this opening pinged nobody',
    )
  }

  if (candidate) {
    const edit = await editChannelMessage(labChannelId, candidate, content, {
      components,
    })

    if (edit.status === 'sent') return { messageId: candidate, landed: true }

    // Anything but `gone` is worth retrying against the same id — the message
    // is still there and Discord was simply unreachable or unhappy. `gone`
    // means it is not ours to edit, so fall through and look properly.
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
 * Discord rate-limits deletes per channel — gently compared to a rename, but
 * not infinitely, and a channel carrying a year of old announcements would walk
 * straight into it. Five a tick clears a normal backlog inside an hour and
 * never spends the budget somebody else's feature might need.
 */
const TIDY_PER_SWEEP = 5

/**
 * Delete every message of the bot's in the lab channel except the sign.
 *
 * **This is what makes "one message" an invariant rather than an intention.**
 * The delete that follows a post can fail, an earlier design can have left a
 * message per opening behind, two instances can both have posted — and none of
 * those heal on their own, because every other path here edits.
 *
 * Bounded three ways, because it is the only destructive thing this file does:
 * it only ever touches messages Discord itself said this bot posted, only in
 * `DISCORD_LAB_CHANNEL_ID`, and never the message the row is using as the sign.
 * A `messages` list it could not read deletes nothing at all.
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

  // Nothing is returned and nothing is recorded, deliberately. A stray left
  // behind must not mark the row unsynced: that would push a *rename* on every
  // tick until the backlog cleared, spending the two-per-ten-minutes budget on
  // a name that was already correct. The next tick tidies again regardless —
  // this runs on every reconcile, not only on a failed one.
}

/**
 * What the reconcile did, for the log and the suite.
 */
export interface LabReconcile {
  /** The row was corrected to match what Discord says. */
  adopted: boolean
  /** Discord and the row already agreed, or Discord could not be read. */
  open: boolean | null
}

/**
 * Read the sign back and make the row match it.
 *
 * **This is the half that makes Discord the record.** Everything else here
 * writes towards Discord; this is the only thing that reads from it, and it is
 * what closes the gap the old design left open — a message edited by hand, a
 * write this process lost between the rename and the row, a second instance
 * that flipped it. Ten minutes late, but agreeing.
 *
 * Two things it will not adopt, and both are the building rather than the sync:
 *
 *   - **Open, overnight.** The curfew is a fact about a locked door and it wins
 *     over anything a channel says. The row is left closed and marked unsynced,
 *     so the push corrects the message instead.
 *   - **A message that says neither.** `signSays` returns null for anything
 *     this feature did not write, and a sign nobody can read is not a state to
 *     adopt.
 *
 * Not serialised on the queue and it does not need to be: it only ever reads
 * Discord, and the write it makes is the same one a concurrent flip would be
 * making. A flip landing between the read and the write loses to the flip,
 * which is the right way round — a press is newer than a ten-minute-old sign.
 */
export async function reconcileLabStatus(
  now: Date = new Date(),
): Promise<LabReconcile> {
  if (!labChannelConfigured || !labChannelId) return { adopted: false, open: null }

  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: signSelect,
  })

  // The same order `writeSign` uses, and it has to be the same: reading one
  // message back and then editing another is a reconcile that adopts the wrong
  // sign every tick.
  const stored =
    (row?.discordMessageId && row.discordChannelId === labChannelId
      ? row.discordMessageId
      : null) ?? labMessageId

  // One listing rather than a fetch of the stored id, because this call has a
  // second job: what it returns *besides* the sign is the set of strays, and
  // clearing those is how "one message" stays true rather than merely intended.
  const existing = await findBotMessages(labChannelId)
  if (existing.status !== 'found') return { adopted: false, open: null }

  const known = existing.messages.find(
    (candidate) => candidate.messageId === stored,
  )

  /**
   * **Only the message the row knows about may change what the lab is**, and
   * this guard is the most important line in the function.
   *
   * "The website syncs with Discord" means the *sign* — the message this
   * feature keeps, that an officer presses a button on and that a person edits
   * when they want to correct it. It does not mean any message the bot happens
   * to have left in the channel, and the difference is not academic: a leftover
   * from an older design saying THE LAB IS CLOSED is indistinguishable from a
   * sign somebody just edited, so without this a stray silently closes the lab
   * for the whole club. That has happened, against the real guild.
   *
   * So a message found by *search* is adopted as the sign — its id is learned,
   * it is what gets edited from here on — but its **state is not read**. The
   * row's own answer is pushed onto it instead. Discord stays the record for
   * the sign the site is actually keeping; it does not become the record for
   * anything that ever landed in the channel.
   */
  const message = known ?? existing.messages[0]!

  if (!known) {
    // Not `adopted`, because nothing was: the id is learned and the sign will
    // be overwritten with the row's state on the push this marks as due.
    console.log(
      `lab status: the sign is ${message.messageId}, which the row did not know about — keeping the site's own state and pushing it`,
    )

    await prisma.labStatus.update({
      where: { id: CURRENT },
      data: {
        discordChannelId: labChannelId,
        discordMessageId: message.messageId,
        discordSynced: false,
      },
    })

    return { adopted: false, open: null }
  }

  const says = signSays(message.content)
  if (says === null) return { adopted: false, open: null }

  // Everything of ours that is not the sign, gone. Deliberately awaited: a tick
  // that adopted a state and left four old announcements above it has done the
  // visible half of the job and skipped the one somebody complained about.
  //
  // Under the guard above, and only under it. Deleting is irreversible, and
  // "which of these is the sign" is exactly the question that was just answered
  // by the row rather than guessed at — a tidy run on a guess deletes the
  // club's real announcement, which is the other half of what went wrong.
  await tidyChannel(existing.messages, message.messageId)

  // A sign saying OPEN overnight is not adopted: the row is left closed and the
  // push corrects the message instead. Worked out before the name is checked,
  // because it is what the name is checked *against* — the question is not
  // "does the channel match its own message" but "does the whole sign match
  // what the lab is about to be".
  const adoptable = says && !buildingOpen(now) ? false : says

  // The name is the other half of the sign and the half that drifts, because a
  // rename is the call Discord throttles hardest. Checked here rather than
  // trusted so a name left behind by a throttled push — or changed by hand — is
  // noticed on the tick rather than at the next flip.
  const expected = adoptable ? LAB_CHANNEL_NAME.open : LAB_CHANNEL_NAME.closed
  const name = await readChannelName(labChannelId)
  const nameAgrees = name.status !== 'found' || name.name === expected

  /**
   * Whether the message carries the buttons it should.
   *
   * This exists for one gap and it is an invisible one. A club that fills in
   * `DISCORD_PUBLIC_KEY` and restarts has a sign whose *content* is already
   * correct, so nothing would push and no buttons would appear until somebody
   * happened to flip the lab — which reads as the key not working. Comparing
   * what is on the message against what `labButtons` would produce turns that
   * into a push on the next tick.
   */
  const buttonsAgree =
    message.hasComponents ===
    labButtons({
      open: adoptable,
      changedAt: null,
      changedBy: null,
      buildingOpen: buildingOpen(now),
    }).length > 0

  /**
   * Whether the sign in Discord already says what the row is about to say —
   * **all of it**, which is the part that was worth being careful with.
   *
   * `adoptable !== says` is the curfew having overruled the message, and it has
   * to force a push on its own. Otherwise a message edited by hand to OPEN at
   * two in the morning, in a channel somebody also renamed green, agrees with
   * itself perfectly and would sit there all night while the row underneath it
   * read closed.
   */
  const signAgrees = nameAgrees && buttonsAgree && adoptable === says

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

  // The id is worth writing back on its own — a message found by search is one
  // the row did not know about, and knowing it saves a listing on every push
  // from here on.
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
      // Nobody here did this. Attributing a message somebody edited in Discord
      // to whoever last used the dashboard would put their name on a decision
      // they did not make.
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
 * The ten-minute tick: lock up if the building has shut, read the sign back,
 * and retry whatever the last push could not get out.
 *
 * Cheap when there is nothing to do — one indexed read of one row and, if
 * Discord is configured, two calls to read the sign. Which is most ticks of
 * most days, because the lab is flipped twice a day.
 */
export async function sweepLabStatus(
  now: Date = new Date(),
): Promise<{ closed: boolean; adopted: boolean; retried: boolean }> {
  const row = await prisma.labStatus.findUnique({
    where: { id: CURRENT },
    select: { open: true, discordSynced: true },
  })

  /**
   * Locking up on the club's behalf, and it is checked **before** anything
   * touching Discord because it changes what those calls would say.
   *
   * Not conditional on Discord being configured either, and that ordering
   * matters: whether the lab is open is a fact about the site, and a club with
   * no bot still gets an honest front page. The `labChannelConfigured` guard
   * belongs to the *sign*, so it sits under this rather than over it.
   *
   * **And it is not vetoed by a throttled rename**, unlike a press. A green
   * sign over a locked building all night is not an outcome worth protecting
   * the rename budget for; the close is committed and the sweep pushes it.
   */
  if (row?.open && !buildingOpen(now)) {
    await prisma.labStatus.update({
      where: { id: CURRENT },
      data: {
        open: false,
        changedAt: now,
        // Nobody closed it. Attributing this to whoever opened the lab at six
        // would put their name on a decision they did not make — and the sign
        // reads better for it, since "Closed 3 minutes ago" beside "the
        // building is shut until 8am" says what happened on its own.
        changedById: null,
        discordSynced: false,
      },
    })

    await pushLabStatus()
    return { closed: true, adopted: false, retried: false }
  }

  if (!labChannelConfigured) return { closed: false, adopted: false, retried: false }

  // Discord is the record, so it is read before anything is pushed at it — a
  // retry that went first would overwrite the very message it is meant to be
  // reconciling against.
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
