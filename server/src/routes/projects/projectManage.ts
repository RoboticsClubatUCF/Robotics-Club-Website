import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate, webUrl } from '../../core/validate.js'
import {
  isOfficer,
  membershipOf,
  requireCurrentDues,
  requireProjectLead,
  requireProjectMember,
  requireTeamLead,
} from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import {
  assertUsableRole,
  discordRoleField,
  pushRoles,
  pushRolesFor,
} from '../../discord/discordRoles.js'
import { env } from '../../core/env.js'
import {
  deleteIfStored,
  looksLikeDocument,
  looksLikeImage,
  storeFile,
} from '../../files/files.js'
import {
  FileKind,
  ProjectMemberRank,
  ProjectStatus,
} from '../../generated/prisma/enums.js'
import { notifyOfficers } from '../../discord/officerNotify.js'
import {
  MEETING_ORDER,
  MEETING_WHOLE,
  meetingIsWhole,
  meetingPatchFields,
  meetingRunsForward,
} from '../../projects/projectMeeting.js'
import { TERM_PAIRED, termFields, termsAgree } from '../../projects/projectTerm.js'
import { rateLimit } from '../../core/rateLimit.js'
import {
  type AuthEnv,
  originGuard,
  requireAuth,
  type SessionUser,
} from '../../auth/session.js'
import { managedProjectSelect } from '../officer/officer.js'

/**
 * Everything that happens inside a project: joining it, running it, and the teams
 * within it.
 *
 *   POST   /api/projects/:id/join                  -> join, dues willing
 *   DELETE /api/projects/:id/members/me            -> leave
 *   GET    /api/projects/:id/team                  -> teams + members, for members
 *   PATCH  /api/projects/:id                       -> edit (project lead)
 *   POST   /api/projects/:id/cover                 -> listing image (project lead)
 *   POST   /api/projects/:id/images                -> gallery, by URL (project lead)
 *   POST   /api/projects/:id/images/upload         -> gallery, by file (project lead)
 *   PATCH  /api/projects/:id/images/order          -> reorder the gallery (project lead)
 *   PATCH  /api/projects/:id/images/:imageId       -> caption (project lead)
 *   DELETE /api/projects/:id/images/:imageId       -> remove a picture (project lead)
 *   PATCH  /api/projects/:id/links                 -> replace the links (project lead)
 *   POST   /api/projects/:id/documents             -> publish a document (project lead)
 *   PATCH  /api/projects/:id/documents/:docId      -> title, blurb, credit (project lead)
 *   POST   /api/projects/:id/documents/:docId/file -> a new revision (project lead)
 *   DELETE /api/projects/:id/documents/:docId      -> withdraw one (project lead)
 *   DELETE /api/projects/:id                       -> delete (project lead)
 *   POST   /api/projects/:id/teams                 -> create a team (project lead)
 *   PATCH  /api/teams/:teamId                      -> rename a team (project lead)
 *   DELETE /api/teams/:teamId                      -> delete a team (project lead)
 *   PATCH  /api/projects/:id/members/:userId       -> team / rank / title (project lead)
 *   DELETE /api/projects/:id/members/:userId       -> remove someone (project lead)
 *   POST   /api/teams/:teamId/members/:userId      -> pull onto the team (team lead)
 *   DELETE /api/teams/:teamId/members/:userId      -> take off the team (team lead)
 *
 * Creating a project is officer business — see `officer.ts` — and so is appointing
 * project leads. The split between the last two pairs is the permission model in
 * miniature: a project lead touches anyone below lead rank, a team lead moves plain
 * members onto and off the one team they lead.
 */
export const projectManage = new Hono<AuthEnv>()

/**
 * Joining gets its own small budget — it's the one route here a brand-new member
 * hits, possibly several times across a browse of the project list. Everything else
 * shares a management budget sized for a lead doing real work in one sitting.
 */
const joins = rateLimit('join', 10)
const writes = rateLimit('manage', 60)

const noSuchProject = () =>
  new HTTPException(404, { message: 'No such project' })

async function getProject(id: string) {
  const project = await prisma.project.findUnique({ where: { id } })
  if (!project) throw noSuchProject()
  return project
}

async function getTeam(teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team) throw new HTTPException(404, { message: 'No such team' })
  return team
}

// ------------------------------------------------------------------ joining

projectManage.post(
  '/projects/:id/join',
  originGuard,
  requireAuth,
  joins,
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))

    if (project.status !== ProjectStatus.IN_PROGRESS) {
      throw new HTTPException(409, {
        message: 'This project is not taking new members.',
      })
    }

    // The dues gate, and literally the same one as everywhere else rather than a
    // second copy. This used to read `hasAccess` and throw its own sentence, which
    // was fine while "no cover" meant one thing and wrong the moment it meant three:
    // during a free window it told somebody to settle dues they didn't owe.
    await requireCurrentDues(user)

    if (await membershipOf(user.id, project.id)) {
      throw new HTTPException(409, {
        message: 'You are already on this project.',
      })
    }

    const membership = await prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id },
      select: { projectId: true, rank: true },
    })

    pushRoles(user.id, `joined ${project.title}`)

    return c.json(membership, 201)
  },
)

/**
 * Leaving. Nobody is locked into a project, including its leads.
 *
 * Deliberately not behind a dues check — walking out isn't a management tool, and
 * `requireCurrentDues` here would trap exactly the people most likely to want out.
 *
 * Including the only lead, which used to be a 409 telling them to ask an officer to
 * appoint another first. That's unfollowable now a project has one lead: there's no
 * second seat to appoint anybody into while they hold the first. So the seat opens
 * and the project is left leaderless, which is already a normal state.
 *
 * What stops that being silent is the officer DM — nobody but an officer can
 * administer a leaderless project. Best-effort, because a member's departure must
 * not depend on Discord being up.
 */
projectManage.delete(
  '/projects/:id/members/me',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const user = c.get('user')
    const projectId = c.req.param('id')

    const membership = await membershipOf(user.id, projectId)
    if (!membership) {
      throw new HTTPException(404, { message: 'You are not on this project.' })
    }

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: user.id } },
    })

    // The union rule earns its keep: somebody leaving one semester's row of a build
    // that runs on keeps the crew role through the other row, and a lead of two
    // projects who walks out of one stays a lead in Discord.
    pushRoles(user.id, 'left a project')

    if (membership.rank === ProjectMemberRank.PROJECT_LEAD) {
      // The title is read here rather than by `getProject` at the top: fetching it
      // up there would turn "you are not on this project" into "no such project"
      // for a bogus id.
      //
      // `othersLeft` is redundant while the one-lead rule holds, and is checked
      // anyway because that rule is enforced by a route rather than an index.
      // Telling the officers a project has no lead when it has one would be worse
      // than saying nothing.
      const [project, othersLeft] = await Promise.all([
        prisma.project.findUnique({
          where: { id: projectId },
          select: { title: true },
        }),
        prisma.projectMember.count({
          where: { projectId, rank: ProjectMemberRank.PROJECT_LEAD },
        }),
      ])

      if (project && othersLeft === 0) {
        void notifyOfficers(
          `⚠️ ${user.fullName} has left ${project.title}, which now has no project lead. Nobody but an officer can run it until one is appointed: ${env.SITE_URL}/dashboard/officer/projects`,
        ).catch((error: unknown) => {
          console.error('officer notify failed', error)
        })
      }
    }

    return c.json({ left: true })
  },
)

// ------------------------------------------------------------ the team view

/**
 * The roster a member sees: who is on the project, on which team, at what rank. No
 * emails — this is every member's view, not the officer desk.
 */
projectManage.get('/projects/:id/team', requireAuth, async (c) => {
  const project = await getProject(c.req.param('id'))
  await requireProjectMember(c.get('user'), project.id)

  const [teams, members] = await Promise.all([
    prisma.team.findMany({
      where: { projectId: project.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      // Rank ascending is leads first — the enum declares most permission first, the
      // same trick the roster plays with UserRole.
      orderBy: [{ rank: 'asc' }, { user: { fullName: 'asc' } }],
      select: {
        userId: true,
        title: true,
        rank: true,
        teamId: true,
        user: { select: { fullName: true, photoUrl: true } },
      },
    }),
  ])

  // The whole managed shape, not just id and title: the manage page prefills its
  // meeting-schedule form from this response, and officers reach that page with no
  // membership row to read the values off. Listed by name rather than spread, so
  // `managedProjectSelect` growing a field does not reach this response — add it in
  // both places or the editor prefills that field with nothing.
  const {
    id,
    slug,
    title,
    summary,
    season,
    termYear,
    termSeason,
    competition,
    status,
    coverUrl,
    coverFromGallery,
    coverFocalX,
    coverFocalY,
    coverZoom,
    galleryHeading,
    resourcesHeading,
    teamHeading,
    featured,
    startedAt,
    completedAt,
    meetingWeekdays,
    meetingStartTime,
    meetingEndTime,
    meetingLocation,
    meetingDescription,
    meetingsPublic,
    discordRoleId,
  } = project

  return c.json({
    project: {
      id,
      slug,
      title,
      summary,
      season,
      termYear,
      termSeason,
      competition,
      status,
      coverUrl,
      coverFromGallery,
      coverFocalX,
      coverFocalY,
      coverZoom,
      galleryHeading,
      resourcesHeading,
      teamHeading,
      featured,
      startedAt,
      completedAt,
      meetingWeekdays,
      meetingStartTime,
      meetingEndTime,
      meetingLocation,
      meetingDescription,
      meetingsPublic,
      discordRoleId,
    },
    teams,
    members: members.map(({ user, ...member }) => ({ ...member, ...user })),
  })
})

// ------------------------------------------------------- the project itself

/**
 * Everything a lead may change. The slug is deliberately absent — it's the public
 * URL, and renaming those is officer-grade breakage. `featured` too: the landing
 * page's shortlist is curation, not self-promotion.
 */
const editProject = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    season: z.string().trim().max(40).nullable().optional(),
    competition: z.string().trim().max(160).nullable().optional(),
    status: z.enum(ProjectStatus).optional(),
    coverUrl: webUrl().nullable().optional(),
    /**
     * Whether the cover is the gallery's first picture rather than `coverUrl`. A
     * lead's call, not an officer's: it decides what this project looks like on
     * `/projects` and nothing else.
     */
    coverFromGallery: z.boolean().optional(),
    /**
     * How the cover sits in the card's frame. Same three numbers and bounds as a
     * gallery picture's, but under their own names — they live on `Project` rather
     * than a `ProjectImage` row, and a shared spread would put `focalX` on both and
     * make the PATCH ambiguous.
     */
    coverFocalX: z.number().min(0).max(100).optional(),
    coverFocalY: z.number().min(0).max(100).optional(),
    coverZoom: z.number().min(1).max(4).optional(),
    /**
     * What this project calls its own sections. Short, because they're set in mono
     * capitals under a `/ ` on a line of their own — 40 characters is already twice
     * the longest of the standing three.
     */
    galleryHeading: z.string().trim().max(40).nullable().optional(),
    resourcesHeading: z.string().trim().max(40).nullable().optional(),
    teamHeading: z.string().trim().max(40).nullable().optional(),
    /**
     * When the project meets. Shared with the create route rather than restated —
     * see `projectMeeting.ts` for the pairing rules.
     *
     * Optional here and required there, and an empty `meetingWeekdays` clears the
     * schedule. Nobody starts a build without knowing when it meets; finishing one
     * and wanting the Tuesday off the front page is a real case.
     */
    ...meetingPatchFields,
    /**
     * Whether the meetings reach the public calendar — officers only, checked in the
     * handler because zod can't see who is asking. Same split as `published` on an
     * event: a lead decides when the project meets, an officer decides whether the
     * front page carries it.
     */
    meetingsPublic: z.boolean().optional(),
    /**
     * The term, editable by the lead and not just officers, unlike `slug` and
     * `featured`. Rolling a build into the next semester only regroups the dashboards
     * of the people already on it, and the person who knows the build is still
     * running is the one running it. Duplicating instead is the officers' call.
     */
    ...termFields,
    /**
     * The crew's Discord role, editable by the lead for the reason the term is:
     * they're the one who knows which channel the build lives in. Setting it hands
     * the role to everybody on the project within ten minutes, and clearing it takes
     * it off them — a real action, not a label.
     */
    ...discordRoleField,
  })
  .refine(termsAgree, TERM_PAIRED)
  .refine(meetingRunsForward, MEETING_ORDER)
  .refine(meetingIsWhole, MEETING_WHOLE)

projectManage.patch(
  '/projects/:id',
  originGuard,
  requireAuth,
  writes,
  validate('json', editProject),
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(user, project.id)
    const patch = c.req.valid('json')

    // The public calendar is officer-run, the same way `published` on an event is. A
    // lead owns the schedule; the front page isn't theirs to put it on.
    if (patch.meetingsPublic !== undefined && !isOfficer(user)) {
      throw new HTTPException(403, {
        message:
          'Only officers can put a project on the public calendar.',
      })
    }

    // The pairing rule holds on the resulting row, whichever half the body carried.
    // Without it, a PATCH naming only `meetingStartTime: null` leaves days with no
    // times: a project that reads as scheduled and appears on no calendar.
    const resulting = {
      meetingWeekdays: patch.meetingWeekdays ?? project.meetingWeekdays,
      meetingStartTime:
        patch.meetingStartTime === undefined
          ? project.meetingStartTime
          : patch.meetingStartTime,
      meetingEndTime:
        patch.meetingEndTime === undefined
          ? project.meetingEndTime
          : patch.meetingEndTime,
    }

    if (!meetingRunsForward(resulting)) {
      throw new HTTPException(400, { message: MEETING_ORDER.message })
    }
    if (!meetingIsWhole(resulting)) {
      throw new HTTPException(400, { message: MEETING_WHOLE.message })
    }

    if (patch.discordRoleId !== undefined) {
      await assertUsableRole(patch.discordRoleId)
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: patch,
      // `description` is added to the shape here and only here. It's left out of
      // `managedProjectSelect` because that feeds `/me/projects`, which every
      // dashboard page loads, and a 20,000-character column per project is a payload
      // nobody asked for. But this route writes it, and the editor rebuilds its state
      // from what a write answers with — omitting it meant the write-up came back
      // `undefined`, vanished from the page, and left the form permanently dirty. A
      // write route answers with what it wrote.
      select: { ...managedProjectSelect, description: true },
    })

    // The storage rule: a cover that was uploaded is deleted the moment it's replaced
    // or cleared. After the update on purpose — losing the old image and failing to
    // set the new one would be the worst of both. `deleteIfStored` ignores external URLs.
    if (patch.coverUrl !== undefined && patch.coverUrl !== project.coverUrl) {
      await deleteIfStored(project.coverUrl)
    }

    // Changing this one field changes what every member of the project should be
    // carrying, unlike anything else on this form. The sweep would reach them within
    // ten minutes regardless, but a lead who has just pasted a role id wants to see
    // it land.
    if (
      patch.discordRoleId !== undefined &&
      patch.discordRoleId !== project.discordRoleId
    ) {
      const roster = await prisma.projectMember.findMany({
        where: { projectId: project.id },
        select: { userId: true },
      })

      pushRolesFor(
        roster.map((member) => member.userId),
        `${project.title}'s Discord role changed`,
      )
    }

    return c.json(updated)
  },
)

/**
 * A cover image as a file, for leads without hosting of their own. Stored the way
 * print files are, addressed as `/api/files/<id>`, and the previous upload — if that
 * is what the old cover was — is deleted on the spot.
 */
projectManage.post(
  '/projects/:id/cover',
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
  rateLimit('upload', 10),
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(user, project.id)

    const body = await c.req.parseBody()
    const file = body['file']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'Attach the image itself.' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeImage(bytes)) {
      throw new HTTPException(400, {
        message: 'That file is not an image the site can show. PNG, JPEG, GIF or WebP.',
      })
    }

    const { url } = await storeFile(FileKind.IMAGE, file, user.id)
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { coverUrl: url },
      select: managedProjectSelect,
    })

    // New image safely in place — now the old upload goes, per the rule.
    await deleteIfStored(project.coverUrl)

    return c.json(updated)
  },
)

// ----------------------------------------------------- the gallery and links

/**
 * A gallery is a story, not an archive. Twelve is more than any club project has
 * needed and still under a megabyte a page once the browser has downscaled them.
 * `MAX_IMAGE_FILE_MB` is the per-file backstop, this is the per-project one.
 * Mirrored in `web/src/lib/projects/projectGallery.ts` so the form can't offer what
 * this refuses.
 */
const MAX_PROJECT_IMAGES = 12
const MAX_PROJECT_LINKS = 10

/**
 * The same idea for the documentation page. Twenty is a design review, a test plan, a
 * wiring diagram and every revision of the competition write-up, with room to spare.
 * `MAX_DOCUMENT_FILE_MB` is the per-file backstop; this matters more than it does for
 * pictures because nothing shrinks a PDF the way `downscaleImage` shrinks a photograph.
 */
const MAX_PROJECT_DOCUMENTS = 20

/**
 * Gallery uploads get their own budget rather than sharing the cover's ten with the
 * print queue: setting a project's page up is a dozen files in one sitting. It has to
 * be a new scope rather than a bigger `max`, because `rateLimit` keys the counter on
 * the scope and compares it to a per-route ceiling — two routes sharing a scope with
 * different maxima means the effective limit depends on which you hit.
 */
const galleryUploads = rateLimit('gallery', 30)

const imageFields = {
  url: webUrl(),
  caption: z.string().trim().max(160).nullable().optional(),
}

/**
 * How a picture is framed inside the gallery's fixed 16:10 well.
 *
 * None of these carry a `.default()`, deliberately. They're reached through a patch,
 * where a default would be written by any request that didn't mention the field — so
 * renaming a caption would silently re-centre a picture somebody had framed. The
 * column defaults in `schema.prisma` are what a picture arriving without framing gets.
 *
 * `zoom` stops at 4. Past that a 1920px upload is being enlarged past its own pixels,
 * and the honest answer to wanting more is a closer photo.
 */
/**
 * The three numbers, as JSON. Exported because the avatar is framed too — see
 * `routes/account/account.ts`. The bounds live here rather than in two places that
 * could drift; `MAX_ZOOM` in `web/src/lib/media/imageFraming.ts` is the browser's
 * mirror of the same 4.
 */
export const framingFields = {
  focalX: z.number().min(0).max(100).optional(),
  focalY: z.number().min(0).max(100).optional(),
  zoom: z.number().min(1).max(4).optional(),
}

/**
 * Framing is accepted when the picture is added, not only afterwards.
 *
 * A gallery assembled on the create page is framed before there's a project to attach
 * it to, so the framing and the picture arrive together — otherwise publishing a draft
 * would be two requests per picture, the second of which could fail on its own.
 */
const addImage = z.object({ ...imageFields, ...framingFields })

const editImage = z.object({
  caption: imageFields.caption,
  ...framingFields,
})

/**
 * Framing off a multipart body, which carries no types: every field arrives as a
 * string, and an untouched one as `''` rather than absent. Anything unparseable is
 * dropped rather than refused — the picture is the point of the request, and a column
 * default is a correct answer for how it's framed. `Number('')` is 0, so the blank
 * check comes first.
 */
export const framingFromBody = (body: Record<string, unknown>) => {
  const read = (name: string, min: number, max: number) => {
    const raw = body[name]
    if (typeof raw !== 'string' || raw.trim() === '') return undefined
    const value = Number(raw)
    return Number.isFinite(value) && value >= min && value <= max
      ? value
      : undefined
  }

  return {
    focalX: read('focalX', 0, 100),
    focalY: read('focalY', 0, 100),
    zoom: read('zoom', 1, 4),
  }
}

const linksBody = z.object({
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        url: webUrl(),
      }),
    )
    .max(MAX_PROJECT_LINKS),
})

const gallerySelect = {
  id: true,
  url: true,
  caption: true,
  focalX: true,
  focalY: true,
  zoom: true,
} as const
const linkSelect = { id: true, label: true, url: true } as const

/** Refuses once the gallery is full, and says the number rather than "too many". */
async function assertRoom(projectId: string) {
  const held = await prisma.projectImage.count({ where: { projectId } })
  if (held >= MAX_PROJECT_IMAGES) {
    throw new HTTPException(409, {
      message: `A project shows up to ${MAX_PROJECT_IMAGES} images. Remove one before adding another.`,
    })
  }
}

/** Appends: new pictures land at the end, where somebody just added them. */
async function nextSortOrder(projectId: string) {
  const { _max } = await prisma.projectImage.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  })
  return (_max.sortOrder ?? -1) + 1
}

/**
 * The image, if it belongs to this project. Matched on the pair, not the id alone: a
 * wrong pairing is then a 404 rather than a cross-project write the lead of one
 * project could aim at another's gallery.
 */
async function getImage(projectId: string, imageId: string) {
  const image = await prisma.projectImage.findFirst({
    where: { id: imageId, projectId },
  })
  if (!image) throw new HTTPException(404, { message: 'No such image' })
  return image
}

/** A picture somebody is hosting themselves. */
projectManage.post(
  '/projects/:id/images',
  originGuard,
  requireAuth,
  writes,
  validate('json', addImage),
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)
    const { url, caption, focalX, focalY, zoom } = c.req.valid('json')

    await assertRoom(project.id)

    const image = await prisma.projectImage.create({
      data: {
        projectId: project.id,
        url,
        caption: caption ?? null,
        // Spread rather than assigned, so an omitted field takes the column's default
        // instead of writing `undefined` over it.
        ...(focalX === undefined ? {} : { focalX }),
        ...(focalY === undefined ? {} : { focalY }),
        ...(zoom === undefined ? {} : { zoom }),
        sortOrder: await nextSortOrder(project.id),
      },
      select: gallerySelect,
    })

    return c.json(image, 201)
  },
)

/**
 * A picture as a file, for leads without hosting of their own.
 *
 * Two routes rather than one that branches on `Content-Type`: the middleware genuinely
 * differs — this one needs `bodyLimit` and the upload budget — and `validate('json')`
 * can't sit in front of a multipart request at all.
 */
projectManage.post(
  '/projects/:id/images/upload',
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
  galleryUploads,
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(user, project.id)

    await assertRoom(project.id)

    const body = await c.req.parseBody()
    const file = body['file']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'Attach the image itself.' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeImage(bytes)) {
      throw new HTTPException(400, {
        message:
          'That file is not an image the site can show. PNG, JPEG, GIF or WebP.',
      })
    }

    // Multipart carries no types, so an empty box arrives as `''` rather than absent —
    // the same coercion the print form's fields make.
    const caption = typeof body['caption'] === 'string' ? body['caption'].trim() : ''
    const { focalX, focalY, zoom } = framingFromBody(body)

    const { url } = await storeFile(FileKind.IMAGE, file, user.id)
    const image = await prisma.projectImage.create({
      data: {
        projectId: project.id,
        url,
        caption: caption.slice(0, 160) || null,
        ...(focalX === undefined ? {} : { focalX }),
        ...(focalY === undefined ? {} : { focalY }),
        ...(zoom === undefined ? {} : { zoom }),
        sortOrder: await nextSortOrder(project.id),
      },
      select: gallerySelect,
    })

    return c.json(image, 201)
  },
)

/**
 * The whole order at once, as a list of ids.
 *
 * `sortOrder` is dense and rewritten as a block, which is why the ids arrive in their
 * new order rather than as one moved id: a whole-block write is the only formulation
 * that can't drift into gaps or duplicates, and at a cap of twelve there's nothing to
 * save by being cleverer.
 *
 * The set check is the lost-update guard: two tabs editing one gallery would otherwise
 * let the older one's list drop the newer one's photo.
 *
 * Registered before `/images/:imageId` on purpose — `order` is a perfectly good
 * uuid-shaped hole for a wildcard to fall into.
 */
projectManage.patch(
  '/projects/:id/images/order',
  originGuard,
  requireAuth,
  writes,
  validate(
    'json',
    z.object({ ids: z.array(z.uuid()).min(1).max(MAX_PROJECT_IMAGES) }),
  ),
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)
    const { ids } = c.req.valid('json')

    const held = await prisma.projectImage.findMany({
      where: { projectId: project.id },
      select: { id: true },
    })

    const sent = new Set(ids)
    const stale =
      sent.size !== ids.length ||
      held.length !== ids.length ||
      held.some((image) => !sent.has(image.id))

    if (stale) {
      throw new HTTPException(409, {
        message:
          'The gallery changed while you were editing it. Reload the page and try again.',
      })
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.projectImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    )

    const images = await prisma.projectImage.findMany({
      where: { projectId: project.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: gallerySelect,
    })

    return c.json(images)
  },
)

/**
 * The caption and the framing — everything about a picture except which picture it is.
 * There's deliberately no way to change `url` in place: replacing one is
 * remove-then-add, which keeps `deleteIfStored` at two call sites rather than three
 * that have to agree.
 *
 * Each field is applied only when it was sent, so the framing panel and the caption box
 * can write independently.
 */
projectManage.patch(
  '/projects/:id/images/:imageId',
  originGuard,
  requireAuth,
  writes,
  validate('json', editImage),
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)

    const image = await getImage(project.id, c.req.param('imageId'))
    const { caption, focalX, focalY, zoom } = c.req.valid('json')

    const updated = await prisma.projectImage.update({
      where: { id: image.id },
      data: {
        // `caption` is nullable, so "absent" and "cleared" are different requests and
        // only the first leaves the column alone.
        ...(caption === undefined ? {} : { caption: caption ?? null }),
        ...(focalX === undefined ? {} : { focalX }),
        ...(focalY === undefined ? {} : { focalY }),
        ...(zoom === undefined ? {} : { zoom }),
      },
      select: gallerySelect,
    })

    return c.json(updated)
  },
)

projectManage.delete(
  '/projects/:id/images/:imageId',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)

    const image = await getImage(project.id, c.req.param('imageId'))

    await prisma.projectImage.delete({ where: { id: image.id } })

    // The reference goes before the bytes, so a failure leaves an orphan row rather
    // than a slide pointing at nothing. `deleteIfStored` ignores external URLs —
    // somebody else's hosting isn't ours to clean up.
    await deleteIfStored(image.url)

    return c.json({ deleted: true })
  },
)

/**
 * The resource links, replaced wholesale.
 *
 * Deliberately not per-row CRUD, and the asymmetry with images has a reason: links own
 * no bytes, so wiping and re-creating can't orphan anything, and nothing references a
 * `ProjectLink.id`. Images can't be edited this way precisely because their rows own
 * bytes. An empty array clears the list.
 */
projectManage.patch(
  '/projects/:id/links',
  originGuard,
  requireAuth,
  writes,
  validate('json', linksBody),
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)
    const { links } = c.req.valid('json')

    await prisma.$transaction([
      prisma.projectLink.deleteMany({ where: { projectId: project.id } }),
      prisma.projectLink.createMany({
        data: links.map((link, index) => ({
          ...link,
          projectId: project.id,
          sortOrder: index,
        })),
      }),
    ])

    const saved = await prisma.projectLink.findMany({
      where: { projectId: project.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: linkSelect,
    })

    return c.json(saved)
  },
)

// ---------------------------------------------------------------- documents

/**
 * The documentation page, the one place the club's own writing lives on this site
 * rather than in somebody's Drive folder.
 *
 * Uploads get their own budget, and it has to be its own scope for the reason
 * `gallery` isn't simply a bigger `upload`: `rateLimit` keys the counter on the scope
 * and compares it to a per-route ceiling.
 */
const documentUploads = rateLimit('document', 20)

const documentLimit = bodyLimit({
  // The file cap plus room for the multipart framing and the title.
  maxSize: env.MAX_DOCUMENT_FILE_MB * 1024 * 1024 + 64 * 1024,
  onError: () => {
    throw new HTTPException(413, {
      message: `That document is too big — the cap is ${env.MAX_DOCUMENT_FILE_MB} MB.`,
    })
  },
})

const WRONG_DOCUMENT =
  'That is not a document the site can publish. PDF or DOCX, and the file has to actually be one.'

const NOT_ON_THE_PROJECT =
  'Credit somebody who is on this project, or credit yourself.'

/**
 * The wire shape, and the one place it's decided — `routes/public/content.ts` serves
 * the same rows to the public page and imports both of these rather than writing the
 * select out again.
 *
 * The file is flattened on the way out. It's a real relation in the database, unlike
 * every image column here, but a reader of the API wants an id, a name and a size
 * rather than a nested object standing in for a table it'll never see.
 */
export const documentSelect = {
  id: true,
  title: true,
  description: true,
  authorName: true,
  uploadedAt: true,
  updatedAt: true,
  file: { select: { id: true, originalName: true, byteSize: true } },
} as const

export const wireDocument = (row: {
  id: string
  title: string
  description: string | null
  authorName: string
  uploadedAt: Date
  updatedAt: Date
  file: { id: string; originalName: string; byteSize: number }
}) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  authorName: row.authorName,
  uploadedAt: row.uploadedAt,
  updatedAt: row.updatedAt,
  fileId: row.file.id,
  fileName: row.file.originalName,
  fileSize: row.file.byteSize,
})

const documentBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  authorUserId: z.uuid().optional(),
})

/** Refuses once the page is full, and says the number rather than "too many". */
async function assertDocumentRoom(projectId: string) {
  const held = await prisma.projectDocument.count({ where: { projectId } })
  if (held >= MAX_PROJECT_DOCUMENTS) {
    throw new HTTPException(409, {
      message: `A project publishes up to ${MAX_PROJECT_DOCUMENTS} documents. Remove one before adding another.`,
    })
  }
}

/**
 * The document, if it belongs to this project. Matched on the pair for the reason
 * `getImage` is: a wrong pairing is a 404 rather than a write the lead of one project
 * could aim at another's page.
 */
async function getDocument(projectId: string, documentId: string) {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, projectId },
  })
  if (!document) throw new HTTPException(404, { message: 'No such document' })
  return document
}

/**
 * Who to credit, and the name to freeze onto the row.
 *
 * The author is somebody on the project — a lead publishes the write-up a member spent
 * a term on — or whoever is uploading, which is the case that matters for an officer
 * editing a project they're not a member of. Anything else is refused: a credit naming
 * a stranger isn't a credit.
 *
 * The name is copied rather than read through the relation at display time, exactly as
 * `OfficerTerm` copies `fullName`. Somebody who graduates and deletes their account
 * still wrote the document.
 */
async function credit(
  projectId: string,
  user: SessionUser,
  authorUserId: string,
): Promise<{ authorId: string; authorName: string }> {
  if (authorUserId === user.id) {
    return { authorId: user.id, authorName: user.fullName }
  }

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: authorUserId } },
    select: { user: { select: { id: true, fullName: true } } },
  })

  if (!member) throw new HTTPException(400, { message: NOT_ON_THE_PROJECT })

  return { authorId: member.user.id, authorName: member.user.fullName }
}

/**
 * The uploaded file and its bytes, once checked.
 *
 * Read here and again by the create below, the same two passes the cover upload makes:
 * `arrayBuffer` re-reads the blob rather than consuming it, and the alternative is
 * threading a buffer through every caller to save a copy of a file already in memory.
 */
async function documentBytes(body: Record<string, unknown>) {
  const file = body['file']

  if (!(file instanceof File) || file.size === 0) {
    throw new HTTPException(400, { message: 'Attach the document itself.' })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!looksLikeDocument(file.name, bytes)) {
    throw new HTTPException(400, { message: WRONG_DOCUMENT })
  }

  return { file, bytes }
}

/**
 * The stored file, as a nested create.
 *
 * Nested rather than `storeFile` followed by a second write, for the reason a print
 * request does the same: the bytes and the row that justifies them land together, so
 * there's no window in which a failure leaves a file nothing points at.
 */
// The buffer is spelled out because Prisma's `Bytes` input is `Uint8Array<ArrayBuffer>`,
// and a bare `Uint8Array` widens to `ArrayBufferLike` — which includes
// `SharedArrayBuffer` and is refused.
const storedFileCreate = (
  file: File,
  bytes: Uint8Array<ArrayBuffer>,
  userId: string,
) => ({
  create: {
    kind: FileKind.DOCUMENT,
    mimeType: file.type || 'application/octet-stream',
    byteSize: bytes.byteLength,
    originalName: file.name.slice(0, 200) || 'upload',
    data: bytes,
    createdById: userId,
  },
})

projectManage.post(
  '/projects/:id/documents',
  originGuard,
  requireAuth,
  documentLimit,
  documentUploads,
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(user, project.id)

    await assertDocumentRoom(project.id)

    // Multipart, so no zValidator — every field is checked here, and an empty box
    // arrives as an empty string rather than absent.
    const body = await c.req.parseBody()
    const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
    const description =
      typeof body['description'] === 'string' ? body['description'].trim() : ''
    const authorUserId =
      typeof body['authorUserId'] === 'string' ? body['authorUserId'] : ''

    if (!title || title.length > 120) {
      throw new HTTPException(400, {
        message: 'Give the document a title, up to 120 characters.',
      })
    }

    // Required, deliberately. A page of uncredited PDFs is the filing cabinet this
    // feature replaces, and the answer is never hard: whoever is uploading it counts.
    if (!authorUserId) {
      throw new HTTPException(400, { message: 'Say who wrote it.' })
    }

    const { file, bytes } = await documentBytes(body)
    const author = await credit(project.id, user, authorUserId)

    const document = await prisma.projectDocument.create({
      data: {
        // `connect` rather than the plain `projectId`/`authorId` columns the patch
        // below writes: Prisma's create input is a union, and naming a foreign key
        // directly picks the branch where nested creates are forbidden.
        project: { connect: { id: project.id } },
        title,
        description: description || null,
        author: { connect: { id: author.authorId } },
        authorName: author.authorName,
        file: storedFileCreate(file, bytes, user.id),
      },
      select: documentSelect,
    })

    return c.json(wireDocument(document), 201)
  },
)

/**
 * Everything about a document except which file it is — the title, the blurb, the
 * credit. Each field is applied only when it was sent, so two boxes can be saved
 * independently.
 */
projectManage.patch(
  '/projects/:id/documents/:documentId',
  originGuard,
  requireAuth,
  writes,
  validate('json', documentBody),
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(user, project.id)

    const document = await getDocument(project.id, c.req.param('documentId'))
    const { title, description, authorUserId } = c.req.valid('json')

    const author =
      authorUserId === undefined
        ? null
        : await credit(project.id, user, authorUserId)

    const updated = await prisma.projectDocument.update({
      where: { id: document.id },
      data: {
        ...(title === undefined ? {} : { title }),
        // `description` is nullable, so "absent" and "cleared" are different requests
        // and only the first leaves the column alone.
        ...(description === undefined
          ? {}
          : { description: description || null }),
        ...(author ?? {}),
        // `updatedAt` deliberately doesn't move here. It means "there's a new version
        // of the file", not "somebody touched this row" — fixing a typo in a title
        // must not tell the club there are forty pages to read again.
      },
      select: documentSelect,
    })

    return c.json(wireDocument(updated))
  },
)

/**
 * A new revision: the same document, a new file.
 *
 * The one route that moves `updatedAt`, and the reason that column exists. The order is
 * the promise the cover upload already makes — the new bytes are in place and the row
 * points at them before the old ones go, so a failure leaves a document with a file
 * rather than a page with a hole in it.
 */
projectManage.post(
  '/projects/:id/documents/:documentId/file',
  originGuard,
  requireAuth,
  documentLimit,
  documentUploads,
  async (c) => {
    const user = c.get('user')
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(user, project.id)

    const document = await getDocument(project.id, c.req.param('documentId'))

    const body = await c.req.parseBody()
    const { file, bytes } = await documentBytes(body)

    const updated = await prisma.projectDocument.update({
      where: { id: document.id },
      data: {
        updatedAt: new Date(),
        file: storedFileCreate(file, bytes, user.id),
      },
      select: documentSelect,
    })

    // `deleteMany` so a file already gone is a no-op: cleanup that can fail the request
    // it rides on is worse than a stray row.
    await prisma.storedFile.deleteMany({ where: { id: document.fileId } })

    return c.json(wireDocument(updated))
  },
)

projectManage.delete(
  '/projects/:id/documents/:documentId',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)

    const document = await getDocument(project.id, c.req.param('documentId'))

    // The row first and the file second, in one transaction: the foreign key is
    // RESTRICT, so deleting the bytes out from under a live document is a constraint
    // violation by design rather than by luck.
    await prisma.$transaction([
      prisma.projectDocument.delete({ where: { id: document.id } }),
      prisma.storedFile.delete({ where: { id: document.fileId } }),
    ])

    return c.json({ deleted: true })
  },
)

projectManage.delete(
  '/projects/:id',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)

    // An uploaded cover goes with the project — nothing would reference it.
    await deleteIfStored(project.coverUrl)

  // And so does every uploaded gallery picture. The `ProjectImage` cascade takes the
  // rows; nothing in Postgres knows a string starting `/api/files/` is a reference, so
  // the bytes have to be swept by hand or they sit in `stored_files` for ever.
  const images = await prisma.projectImage.findMany({
    where: { projectId: project.id },
    select: { url: true },
  })
  for (const image of images) {
    await deleteIfStored(image.url)
  }

  // And every published document — a real foreign key rather than a URL in a string
  // column, so it needs sweeping for the opposite reason: `ProjectDocument` cascades
  // away with the project, which drops the reference and leaves the `stored_files` row
  // holding megabytes nothing can reach. Read the ids before the cascade eats the rows.
  const documents = await prisma.projectDocument.findMany({
    where: { projectId: project.id },
    select: { fileId: true },
  })

  // Read the roster before the cascade eats it. `ProjectMember` goes with the project
  // through `onDelete: Cascade`, silently and with no per-row code path, so this is the
  // last moment anything can know whose Discord roles just stopped being justified.
  const roster = await prisma.projectMember.findMany({
    where: { projectId: project.id },
    select: { userId: true },
  })

  // Members detach before their teams go: the (teamId, projectId) foreign key is
  // RESTRICT, so deleting teams out from under seated members is a constraint violation
  // by design.
  await prisma.$transaction([
    prisma.projectMember.updateMany({
      where: { projectId: project.id },
      data: { teamId: null },
    }),
    prisma.project.delete({ where: { id: project.id } }),
  ])

  // After the cascade, because until then the RESTRICT on `project_documents` is exactly
  // what stops this running.
  if (documents.length > 0) {
    await prisma.storedFile.deleteMany({
      where: { id: { in: documents.map((document) => document.fileId) } },
    })
  }

  pushRolesFor(
    roster.map((member) => member.userId),
    `${project.title} was deleted`,
  )

  return c.json({ deleted: true })
})

// -------------------------------------------------------------------- teams

const teamBody = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
})

projectManage.post(
  '/projects/:id/teams',
  originGuard,
  requireAuth,
  writes,
  validate('json', teamBody),
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)
    const { name, description } = c.req.valid('json')

    // Pre-checked rather than caught, same reasoning as the slug in officer.ts.
    const taken = await prisma.team.findUnique({
      where: { projectId_name: { projectId: project.id, name } },
    })
    if (taken) {
      throw new HTTPException(409, {
        message: 'This project already has a team by that name.',
      })
    }

    const team = await prisma.team.create({
      data: { projectId: project.id, name, description: description ?? null },
      select: { id: true, name: true, description: true },
    })

    return c.json(team, 201)
  },
)

projectManage.patch(
  '/teams/:teamId',
  originGuard,
  requireAuth,
  writes,
  validate('json', teamBody.partial()),
  async (c) => {
    const team = await getTeam(c.req.param('teamId'))
    await requireProjectLead(c.get('user'), team.projectId)
    const { name, description } = c.req.valid('json')

    if (name && name !== team.name) {
      const taken = await prisma.team.findUnique({
        where: { projectId_name: { projectId: team.projectId, name } },
      })
      if (taken) {
        throw new HTTPException(409, {
          message: 'This project already has a team by that name.',
        })
      }
    }

    const updated = await prisma.team.update({
      where: { id: team.id },
      data: { name, description },
      select: { id: true, name: true, description: true },
    })

    return c.json(updated)
  },
)

projectManage.delete(
  '/teams/:teamId',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const team = await getTeam(c.req.param('teamId'))
    await requireProjectLead(c.get('user'), team.projectId)

  // Who is about to be demoted, read before the bulk update makes it unknowable —
  // `updateMany` answers with a count and no identities.
  const demoted = await prisma.projectMember.findMany({
    where: {
      projectId: team.projectId,
      teamId: team.id,
      rank: ProjectMemberRank.TEAM_LEAD,
    },
    select: { userId: true },
  })

  // Three steps, one transaction. The demotion is the subtle one: a TEAM_LEAD rank means
  // nothing without a team under it, and leaving the rank behind would hand its holder
  // the next team they happened to join.
  await prisma.$transaction([
    prisma.projectMember.updateMany({
      where: {
        projectId: team.projectId,
        teamId: team.id,
        rank: ProjectMemberRank.TEAM_LEAD,
      },
      data: { rank: ProjectMemberRank.MEMBER },
    }),
    prisma.projectMember.updateMany({
      where: { projectId: team.projectId, teamId: team.id },
      data: { teamId: null },
    }),
    prisma.team.delete({ where: { id: team.id } }),
  ])

  pushRolesFor(
    demoted.map((member) => member.userId),
    `${team.name} was deleted`,
  )

  return c.json({ deleted: true })
})

// ------------------------------------------------- members, as a lead sees them

/**
 * A project lead placing people: team, rank up to TEAM_LEAD, display title.
 * `PROJECT_LEAD` isn't in the enum here on purpose — leads are appointed by officers,
 * and a lead who could mint leads could mint their successor before an officer heard
 * about either.
 *
 * This is also the route officers use to appoint a team lead, reached because
 * `requireProjectLead` returns early for them — one route for that rank rather than an
 * officer-only duplicate that could drift.
 *
 * `title` was called `role` until the roles were untangled, and the rename fails
 * quietly: zod strips unknown keys, so a caller still sending `role` gets a 200 and
 * saves nothing. There's a test on exactly that.
 */
const editMember = z.object({
  teamId: z.uuid().nullable().optional(),
  rank: z.enum([ProjectMemberRank.TEAM_LEAD, ProjectMemberRank.MEMBER]).optional(),
  title: z.string().trim().max(80).nullable().optional(),
})

projectManage.patch(
  '/projects/:id/members/:userId',
  originGuard,
  requireAuth,
  writes,
  validate('json', editMember),
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)
    const userId = c.req.param('userId')
    const patch = c.req.valid('json')

    const target = await membershipOf(userId, project.id)
    if (!target) {
      throw new HTTPException(404, { message: 'They are not on this project.' })
    }

    if (target.rank === ProjectMemberRank.PROJECT_LEAD) {
      throw new HTTPException(403, {
        message: 'Project leads are appointed and changed by officers.',
      })
    }

    if (patch.teamId) {
      const team = await prisma.team.findUnique({
        where: { id: patch.teamId },
        select: { projectId: true },
      })
      // The composite FK would refuse this anyway; checking first turns a constraint
      // violation into a sentence.
      if (team?.projectId !== project.id) {
        throw new HTTPException(400, {
          message: 'That team is not part of this project.',
        })
      }
    }

    // The invariant is on the resulting row, whichever half the patch sent: a team lead
    // always has a team.
    const resulting = {
      rank: patch.rank ?? target.rank,
      teamId: patch.teamId === undefined ? target.teamId : patch.teamId,
    }
    if (resulting.rank === ProjectMemberRank.TEAM_LEAD && !resulting.teamId) {
      throw new HTTPException(400, {
        message: 'A team lead needs a team — pick one first.',
      })
    }

    const membership = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId } },
      data: patch,
      select: { userId: true, title: true, rank: true, teamId: true },
    })

    if (patch.rank !== undefined) {
      pushRoles(userId, `rank changed on ${project.title}`)
    }

    return c.json(membership)
  },
)

projectManage.delete(
  '/projects/:id/members/:userId',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const project = await getProject(c.req.param('id'))
    await requireProjectLead(c.get('user'), project.id)
    const userId = c.req.param('userId')

    const target = await membershipOf(userId, project.id)
    if (!target) {
      throw new HTTPException(404, { message: 'They are not on this project.' })
    }

    if (target.rank === ProjectMemberRank.PROJECT_LEAD) {
      throw new HTTPException(403, {
        message: 'Project leads are appointed and changed by officers.',
      })
    }

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: project.id, userId } },
    })

    pushRoles(userId, `removed from ${project.title}`)

    return c.json({ removed: true })
  },
)

// ----------------------------------------------- members, as a team lead sees them

/**
 * The team lead's whole kingdom: plain members, on and off their own team. Anyone
 * ranked is out of reach, and so is anyone already seated on a different team —
 * poaching is settled between leads, by the project lead, at the route above.
 */
projectManage.post(
  '/teams/:teamId/members/:userId',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const user = c.get('user')
    const teamId = c.req.param('teamId')
    const userId = c.req.param('userId')

    const { projectId } = await requireTeamLead(user, teamId)

    const target = await membershipOf(userId, projectId)
    if (!target) {
      throw new HTTPException(404, { message: 'They are not on this project.' })
    }
    if (target.rank !== ProjectMemberRank.MEMBER) {
      throw new HTTPException(403, {
        message: 'Only the project lead can move other leads.',
      })
    }
    if (target.teamId && target.teamId !== teamId) {
      throw new HTTPException(409, {
        message:
          'They are already on another team. Ask the project lead to move them.',
      })
    }

    const membership = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { teamId },
      select: { userId: true, title: true, rank: true, teamId: true },
    })

    return c.json(membership)
  },
)

projectManage.delete(
  '/teams/:teamId/members/:userId',
  originGuard,
  requireAuth,
  writes,
  async (c) => {
    const user = c.get('user')
    const teamId = c.req.param('teamId')
    const userId = c.req.param('userId')

    const { projectId } = await requireTeamLead(user, teamId)

    const target = await membershipOf(userId, projectId)
    if (!target || target.teamId !== teamId) {
      throw new HTTPException(404, { message: 'They are not on this team.' })
    }
    if (target.rank !== ProjectMemberRank.MEMBER) {
      throw new HTTPException(403, {
        message: 'Only the project lead can move other leads.',
      })
    }

    const membership = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { teamId: null },
      select: { userId: true, title: true, rank: true, teamId: true },
    })

    return c.json(membership)
  },
)
