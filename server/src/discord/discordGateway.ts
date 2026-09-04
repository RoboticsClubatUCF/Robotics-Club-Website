import {
  discordConfigured,
  gatewayConnected,
  respondToInteraction,
  setGatewayConnected,
} from './discord.js'
import { env } from '../core/env.js'
import { type Interaction, handleLabInteraction } from '../lab/labInteraction.js'

/**
 * The bot's connection to Discord, held open, so a button press reaches us.
 *
 * The rest of this codebase talks to Discord over REST and holds nothing open. Buttons
 * are the exception, and not by preference: a bot is told about a press in exactly two
 * ways, and there is no third. Either Discord POSTs it to a public HTTPS URL registered
 * on the application, or it delivers it down a WebSocket the bot already holds open.
 *
 * The first needs the site reachable from the internet, a signature checked on every
 * delivery, and a tunnel in development — out of all proportion to a light switch, and
 * impossible while the site has never been deployed. The second needs this file and
 * nothing else: no public address, no key, nothing to configure, because the connection
 * is authenticated once at IDENTIFY by the bot token.
 *
 * So the club runs on this, and `routes/webhooks/discordInteractions.ts` stays for the
 * day the API is on a real domain. They can't both be live: an application with an
 * interactions endpoint URL has every interaction POSTed there, so this only connects
 * when there's no URL set — checked once at startup rather than guessed at.
 *
 * No `discord.js`. What a library gives you is sharding, a member cache and an event
 * surface for a hundred things this club doesn't do. What's needed is connect, identify,
 * heartbeat, notice when the connection has died, and resume.
 *
 * No intents. `intents: 0` isn't an oversight — interactions are delivered regardless of
 * intents, and asking for message content would be asking for privileged access to run a
 * light switch.
 *
 * Every instance that runs this opens its own connection and is told about every press,
 * so three API instances would flip the lab three times over. At club scale there's one.
 * Past that, the answer is an interactions endpoint URL, which turns this off by itself.
 */

const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'

/** Discord's gateway opcodes, the ones this speaks. */
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const

/**
 * Close codes Discord uses to say "do not come back".
 *
 * Reconnecting on one of these is how a bot spends its daily identify budget in a loop
 * and gets the token disabled, so they stop the retry rather than lengthening it. Every
 * other close is a network event and is retried.
 */
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014])

interface Payload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

let socket: WebSocket | null = null
let heartbeat: NodeJS.Timeout | null = null
/** The last sequence number seen, which is what a RESUME is anchored to. */
let sequence: number | null = null
let sessionId: string | null = null
/** Where to reconnect to keep a session — Discord hands this out at READY and it isn't
    the same host as the one you first connect to. */
let resumeUrl: string | null = null
/** Set when a heartbeat goes out, cleared when Discord acknowledges it. A heartbeat sent
    while this is still set means the connection is a zombie: open at the socket level,
    and nothing reading the other end. */
let awaitingAck = false
let attempts = 0
let stopped = false

const backoff = () =>
  // A few seconds, then longer, capped. Discord rate-limits identify hard, and a tight
  // reconnect loop against an outage is how one bot becomes the outage's problem too.
  Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5)) + Math.random() * 1_000

function send(payload: Payload): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
}

function startHeartbeat(interval: number): void {
  stopHeartbeat()
  awaitingAck = false

  // The first one is jittered across the interval, which is Discord's own instruction:
  // every bot in the world reconnecting after an outage would otherwise heartbeat in
  // lockstep.
  setTimeout(() => {
    if (socket?.readyState !== WebSocket.OPEN) return
    beat()
    heartbeat = setInterval(beat, interval)
  }, interval * Math.random())
}

function beat(): void {
  if (awaitingAck) {
    // Nothing has acknowledged the last one. The socket is open and dead, which is the
    // failure a keepalive exists to catch — close it and resume.
    console.warn('discord gateway: no heartbeat ack, reconnecting')
    socket?.close(4000, 'heartbeat timeout')
    return
  }

  awaitingAck = true
  send({ op: OP.HEARTBEAT, d: sequence })
}

function identify(): void {
  send({
    op: OP.IDENTIFY,
    d: {
      token: env.DISCORD_BOT_TOKEN,
      // See the note at the top: interactions arrive regardless of intents, and asking
      // for more would be asking for privileged access to run a switch.
      intents: 0,
      properties: { os: process.platform, browser: 'rccf-website', device: 'rccf-website' },
    },
  })
}

function resume(): void {
  send({
    op: OP.RESUME,
    d: { token: env.DISCORD_BOT_TOKEN, session_id: sessionId, seq: sequence },
  })
}

function connect(): void {
  if (stopped) return

  const url = sessionId && resumeUrl ? `${resumeUrl}/?v=10&encoding=json` : GATEWAY

  let ws: WebSocket

  try {
    ws = new WebSocket(url)
  } catch (error) {
    console.error('discord gateway: could not open a socket', error)
    scheduleReconnect()
    return
  }

  socket = ws

  ws.addEventListener('message', (event) => {
    let payload: Payload

    try {
      payload = JSON.parse(String(event.data)) as Payload
    } catch {
      return
    }

    if (typeof payload.s === 'number') sequence = payload.s

    switch (payload.op) {
      case OP.HELLO: {
        const { heartbeat_interval: interval } = payload.d as {
          heartbeat_interval: number
        }
        startHeartbeat(interval)
        // Resume if there's a session to resume; Discord replays whatever was missed. A
        // press that arrived while the connection was down isn't lost, which is the whole
        // reason to bother resuming.
        if (sessionId) resume()
        else identify()
        return
      }

      case OP.HEARTBEAT:
        // Discord asking for one out of band. Answered immediately.
        send({ op: OP.HEARTBEAT, d: sequence })
        return

      case OP.HEARTBEAT_ACK:
        awaitingAck = false
        return

      case OP.RECONNECT:
        ws.close(4000, 'asked to reconnect')
        return

      case OP.INVALID_SESSION:
        // `d` is whether the session is resumable. Not, usually — so drop it and identify
        // fresh after the delay Discord asks for.
        if (payload.d !== true) {
          sessionId = null
          resumeUrl = null
          sequence = null
        }
        setTimeout(() => {
          if (sessionId) resume()
          else identify()
        }, 1_000 + Math.random() * 4_000)
        return

      case OP.DISPATCH:
        onDispatch(payload)
        return

      default:
        return
    }
  })

  ws.addEventListener('open', () => {
    // Not connected until READY or RESUMED; the socket being open only means Discord is
    // listening, not that it has accepted the token.
    console.log('discord gateway: socket open')
  })

  ws.addEventListener('error', () => {
    // The close event follows and carries the reason, so this only exists to stop an
    // unhandled error event taking the process down.
  })

  ws.addEventListener('close', (event) => {
    stopHeartbeat()
    setGatewayConnected(false)
    socket = null

    if (stopped) return

    if (FATAL.has(event.code)) {
      // Almost always a bad token or intents the application hasn't been granted.
      // Retrying spends the identify budget and changes nothing.
      console.error(
        `discord gateway: closed ${event.code} ${event.reason} — not reconnecting. Lab buttons are off until this is fixed and the server restarted.`,
      )
      return
    }

    // 4009 is "session timed out": the session is gone but the token is fine.
    if (event.code === 4009) {
      sessionId = null
      resumeUrl = null
    }

    console.warn(
      `discord gateway: closed ${event.code}${event.reason ? ` ${event.reason}` : ''}, reconnecting`,
    )
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  const delay = backoff()
  attempts += 1
  setTimeout(connect, delay).unref()
}

function onDispatch(payload: Payload): void {
  if (payload.t === 'READY') {
    const ready = payload.d as {
      session_id?: string
      resume_gateway_url?: string
      user?: { username?: string }
    }
    sessionId = ready.session_id ?? null
    resumeUrl = ready.resume_gateway_url ?? null
    attempts = 0
    setGatewayConnected(true)
    console.log(
      `Lab buttons → Discord gateway, as ${ready.user?.username ?? 'the bot'} (no public URL needed)`,
    )
    return
  }

  if (payload.t === 'RESUMED') {
    attempts = 0
    setGatewayConnected(true)
    console.log('discord gateway: resumed')
    return
  }

  if (payload.t !== 'INTERACTION_CREATE') return

  const interaction = payload.d as Interaction

  // Deliberately not awaited, for the same three-second deadline the HTTP route has:
  // `handleLabInteraction` answers without touching Discord and fires the flip off
  // behind itself.
  void handleLabInteraction(interaction)
    .then(async (response) => {
      if (!interaction.id || !interaction.token) return
      await respondToInteraction(interaction.id, interaction.token, response)
    })
    .catch((error: unknown) => {
      console.error('discord gateway: could not answer an interaction', error)
    })
}

/**
 * Open the connection, if this is the instance that should hold one.
 *
 * Called once at startup with whether the application has an HTTP interactions endpoint.
 * If it does, this stays shut: Discord would send the press there and nothing would ever
 * arrive here.
 */
export function startDiscordGateway(hasHttpEndpoint: boolean): void {
  if (!discordConfigured) return

  if (hasHttpEndpoint) {
    console.log(
      'discord gateway: not connecting — the application has an interactions endpoint URL, so presses go there',
    )
    return
  }

  stopped = false
  connect()
}

/** For shutdown, so a closing process doesn't look like a dropped connection and doesn't
    hold the event loop open. */
export function stopDiscordGateway(): void {
  stopped = true
  stopHeartbeat()
  setGatewayConnected(false)
  socket?.close(1000, 'shutting down')
  socket = null
}

/** Whether a press would reach us right now. Read by `buttonsLive`. */
export const gatewayIsConnected = (): boolean => gatewayConnected()
