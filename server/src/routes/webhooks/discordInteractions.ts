import { Hono } from 'hono'
import { interactionsConfigured, verifyInteraction } from '../../discord/discord.js'
import {
  type Interaction,
  handleLabInteraction,
} from '../../lab/labInteraction.js'

/**
 * Discord POSTing a button press to us.
 *
 *   POST /api/discord/interactions
 *
 * The road the club does not use. A bot is told about a press in exactly two ways: down a WebSocket
 * it already holds open, or by an HTTP POST to a public URL registered on the application. The
 * first needs nothing configured and is what runs here — `src/discord/discordGateway.ts`. This is
 * the second, kept for the day the API is on a real domain, where a stateless endpoint beats a
 * socket every instance has to hold.
 *
 * They are never both live. An application with an interactions endpoint URL has every interaction
 * POSTed to it and its gateway told nothing, so which one is running is decided by whether that URL
 * is set — read off Discord at startup, not configured on this side.
 *
 * What a press means is `src/lab/labInteraction.ts`, shared with the gateway. What is left here is
 * the part that is only true of HTTP, and it is four things.
 *
 * The body must stay raw: the Ed25519 signature is over the exact bytes Discord sent, prefixed by
 * the timestamp header, so anything that parses and re-serialises the JSON first invalidates it.
 * Hence `c.req.text()` and no `zValidator`.
 *
 * The signature is the only thing standing in for authentication, and a press opens a real room.
 * Without `DISCORD_PUBLIC_KEY` every delivery is refused. The gateway needs none of this because
 * its connection is authenticated once, at IDENTIFY, by the bot token.
 *
 * 401 on a bad signature, and it has to be 401: Discord probes a new endpoint URL with a
 * deliberately invalid signature before it will accept it, and an endpoint that answers 200 to that
 * is rejected outright. The one place here where the refusal status is somebody else's requirement.
 *
 * And a replay is refused on its age. The signature covers the timestamp but says nothing about
 * when, so a press captured off the wire would otherwise toggle a room for ever.
 */
export const discordInteractions = new Hono()

/**
 * How far out of date a delivery may be. Five minutes is Discord's own
 * tolerance elsewhere and far more than the three seconds a real interaction is
 * alive for.
 */
const MAX_SKEW_SECONDS = 300

discordInteractions.post('/interactions', async (c) => {
  if (!interactionsConfigured) {
    console.error(
      'discord interactions: refused a delivery — DISCORD_PUBLIC_KEY is not configured',
    )
    return c.json({ error: 'Interactions are not configured.' }, 503)
  }

  const body = await c.req.text()
  const timestamp = c.req.header('x-signature-timestamp')

  if (!verifyInteraction(body, c.req.header('x-signature-ed25519'), timestamp)) {
    // See the note above: Discord itself sends a bad signature on purpose when
    // the endpoint URL is saved, and expects exactly this.
    return c.json({ error: 'invalid request signature' }, 401)
  }

  const sent = Number(timestamp)

  if (
    !Number.isFinite(sent) ||
    Math.abs(Date.now() / 1_000 - sent) > MAX_SKEW_SECONDS
  ) {
    console.warn('discord interactions: refused a delivery on its age')
    return c.json({ error: 'invalid request signature' }, 401)
  }

  let interaction: Interaction

  try {
    interaction = JSON.parse(body) as Interaction
  } catch {
    return c.json({ error: 'unparseable body' }, 400)
  }

  return c.json(await handleLabInteraction(interaction))
})
