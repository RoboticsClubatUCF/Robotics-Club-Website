import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { looksLikePrintModel } from '../../files/files.js'
import { FileKind, PrintRequestStatus } from '../../generated/prisma/enums.js'
import { notifyOfficers } from '../../discord/officerNotify.js'
import {
  MATERIAL_LABEL,
  printSettings,
  settingsColumns,
} from '../../printing/printSettings.js'
import { rateLimit } from '../../core/rateLimit.js'
import { currentTerm } from '../../membership/semester.js'
import { requireDuesForRoute } from '../../auth/authz.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * 3D print requests.
 *
 *   POST   /api/print      -> upload a model (.stl / .step only) + settings
 *   DELETE /api/print/:id  -> withdraw one, while it is still PENDING
 *
 * The upload is multipart and buffered, which is why `bodyLimit` runs before
 * anything else — the cap has to reject the body before this process holds
 * it. The file's bytes live only as long as the job does: the officer queue
 * deletes them at DONE or REJECTED, and withdrawal deletes them here.
 *
 * A request carries the settings an officer would otherwise have to read out
 * of prose — process, material, infill — validated as a pair by
 * `printSettings.ts`, plus the project it is for. **That project, or its
 * absence, is the budget rule**: a personal print comes out of the member's
 * per-term allowance and a project print is uncapped.
 *
 * **Paid-up members only, not merely signed-in.** `requireDuesForRoute` is the
 * whole gate, and it is the same one the management pages use: the printers run
 * on club money, and an account is not a membership. This used to be a stricter
 * check of its own, `requireClubMember`, which also refused a `GUEST` — that
 * mattered when the summer granted everybody access whether or not they had
 * claimed it. It no longer does, so the two collapsed. See `authz.ts`.
 *
 * The member's own list is `GET /api/me/print-requests` and their balance is
 * `GET /api/me/print-allowance`; the officer queue is under `/api/officer`.
 */
export const print = new Hono<AuthEnv>()

/**
 * Five per window, the site default. A print request is one considered ask —
 * this is the same budget the contact form gets, and for the same reason:
 * each one lands on a human.
 */
const submissions = rateLimit('print', 5)

const uploadLimit = bodyLimit({
  // The file cap plus a little for the multipart framing and the notes field.
  maxSize: env.MAX_PRINT_FILE_MB * 1024 * 1024 + 64 * 1024,
  onError: () => {
    throw new HTTPException(413, {
      message: `That file is too big — the cap is ${env.MAX_PRINT_FILE_MB} MB.`,
    })
  },
})

const WRONG_KIND = `That doesn't look like a printable model. The printers take .stl and .step files.`

/**
 * A multipart field as something zod can look at.
 *
 * Every value in a multipart body is a string, and a `<select>` that has not
 * been touched sends an empty one. Empty has to become `undefined` or the
 * optional fields on an SLA request arrive as `''` and fail as "present with a
 * value" — which is exactly the mistake the union is there to catch, reported
 * against a member who did nothing wrong.
 */
const field = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/**
 * How many of one thing somebody may ask for in a single request.
 *
 * A ceiling rather than a policy: fifty small clips is a real ask and the club
 * has no rule against it, but a four-figure number in that box is a typo or a
 * misunderstanding about whose printers these are. The officer's discretion is
 * the actual limit — this only stops the box being nonsense.
 */
const MAX_QUANTITY = 50

/** What the member's own list and the create response both answer with. */
export const printSelect = {
  id: true,
  fileName: true,
  fileSize: true,
  quantity: true,
  notes: true,
  status: true,
  startedAt: true,
  officerNote: true,
  fileId: true,
  process: true,
  material: true,
  infillPattern: true,
  infillDensity: true,
  gramsUsed: true,
  printedProcess: true,
  printedMaterial: true,
  printedInfillPattern: true,
  printedInfillDensity: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, slug: true, title: true } },
} as const

print.post(
  '/',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  uploadLimit,
  submissions,
  async (c) => {
    const user = c.get('user')

    // Multipart, so no zValidator — the body is parsed by hand and every
    // field is checked here instead.
    const body = await c.req.parseBody()
    const file = body['file']
    const rawNotes = body['notes']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'Attach the model file itself.' })
    }

    const settings = printSettings.safeParse({
      process: field(body['process']),
      material: field(body['material']),
      infillPattern: field(body['infillPattern']),
      infillDensity: field(body['infillDensity']),
    })

    if (!settings.success) {
      throw new HTTPException(400, {
        // One sentence rather than the zod report, which is a debugging aid.
        // Every way to fail this is the same mistake from the member's side:
        // a combination the printers cannot do.
        message:
          'Those print settings do not go together. FDM takes PLA or PETG with an infill; resin takes the ABS-like resin and has no infill.',
      })
    }

    /**
     * Which project it is for, and therefore whose grams it costs.
     *
     * A plain membership lookup rather than `requireProjectMember`, and that is
     * on purpose: that helper waves officers through, and here it would be a
     * hole in the budget — an officer could bill any print to any project and
     * never touch their own allowance. Saying a print is for a project is a
     * claim about your own work, not an administrative act, so everybody needs
     * the row.
     */
    const projectId = field(body['projectId']) ?? null

    if (projectId) {
      const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
        select: { projectId: true },
      })

      if (!membership) {
        throw new HTTPException(403, {
          message: 'You can only put a print against a project you are on.',
        })
      }
    }

    // Defaulted rather than required: one of a thing is what almost every
    // request is, and a form that refuses to send without a number typed into
    // a box that already says 1 is a form arguing with its reader.
    const quantity = z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_QUANTITY)
      .default(1)
      .safeParse(field(body['quantity']))

    if (!quantity.success) {
      throw new HTTPException(400, {
        message: `Ask for between 1 and ${MAX_QUANTITY} of it. More than that is worth speaking to an officer about.`,
      })
    }

    const notes =
      typeof rawNotes === 'string' && rawNotes.trim()
        ? rawNotes.trim().slice(0, 1_000)
        : null

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikePrintModel(file.name, bytes)) {
      throw new HTTPException(400, { message: WRONG_KIND })
    }

    // Frozen now, so "which semester was this" survives UCF revising its
    // calendar. `currentTerm`, not `billableTerm` — summer is a term of its
    // own for the allowance even though dues skip it.
    const term = await currentTerm()

    // One nested create: the request and its file exist together or not at
    // all — a file with no request would be unfindable dead weight.
    const request = await prisma.printRequest.create({
      data: {
        user: { connect: { id: user.id } },
        fileName: file.name.slice(0, 200),
        fileSize: bytes.byteLength,
        quantity: quantity.data,
        notes,
        ...settingsColumns(settings.data),
        ...(projectId ? { project: { connect: { id: projectId } } } : {}),
        termYear: term.year,
        termSeason: term.season,
        file: {
          create: {
            kind: FileKind.PRINT_MODEL,
            mimeType: file.type || 'application/octet-stream',
            byteSize: bytes.byteLength,
            originalName: file.name.slice(0, 200),
            data: bytes,
            createdById: user.id,
          },
        },
      },
      select: printSelect,
    })

    const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1)
    const forWhom = request.project ? `for ${request.project.title}` : 'personal'
    // Only when it is not one, so the common case reads as a sentence rather
    // than as a form.
    const howMany = request.quantity > 1 ? ` ×${String(request.quantity)}` : ''
    // Fire and forget — the member's upload must not wait on Discord.
    void notifyOfficers(
      `🖨️ New 3D print request from ${user.fullName}: ${request.fileName}${howMany} (${mb} MB) — ${request.process}, ${MATERIAL_LABEL[request.material]}, ${forWhom}. Queue: ${env.SITE_URL}/dashboard/officer/print`,
    ).catch((error: unknown) => {
      console.error('officer notify failed', error)
    })

    return c.json(request, 201)
  },
)

print.delete(
  '/:id',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  submissions,
  async (c) => {
    const user = c.get('user')

    const request = await prisma.printRequest.findUnique({
      where: { id: c.req.param('id') },
      select: { id: true, userId: true, status: true, fileId: true },
    })

    if (!request || request.userId !== user.id) {
      // One answer for "not yours" and "not there" — a request id is not a
      // thing to probe.
      throw new HTTPException(404, { message: 'No such print request.' })
    }

    if (request.status !== PrintRequestStatus.PENDING) {
      throw new HTTPException(409, {
        message: 'This request is already being handled — talk to the officer on it.',
      })
    }

    // Withdrawing takes the bytes too: nothing else references the file, and
    // the whole storage rule is that unneeded models do not sit in the database.
    await prisma.$transaction([
      prisma.printRequest.delete({ where: { id: request.id } }),
      ...(request.fileId
        ? [prisma.storedFile.deleteMany({ where: { id: request.fileId } })]
        : []),
    ])

    return c.json({ deleted: true })
  },
)
