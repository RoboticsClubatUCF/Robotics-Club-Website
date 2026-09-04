import { useEffect, useId, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { Status } from '../../components/shared/Status'
import { useSectionStatus } from '../../lib/useSectionStatus'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import {
  FormEyebrow,
  FormHeading,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import {
  ApiError,
  deleteJson,
  getJson,
  patchJson,
  postForm,
  postJson,
  putJson,
} from '../../lib/api/api'
import type {
  ApiInKindOffer,
  ApiManagedSponsor,
  ApiSponsorDesk,
  ApiTierOffer,
  SponsorTier,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { ACCEPTED_IMAGE_TYPES, downscaleImage } from '../../lib/media/downscaleImage'
import { duesLocked } from '../../lib/dues/dues'
import { hits } from '../../lib/equipment/catalogue'
import { moveItem } from '../../lib/projects/projectGallery'
import { MAX_BENEFITS, MAX_IN_KIND, tierLabel } from '../../lib/sponsorship'
import { linesFromText, linesToText } from '../../lib/textLines'
import { imageSrc, isStoredUpload } from '../../lib/media/storedFiles'

/**
 * `/dashboard/officer/sponsors` — the whole of `/sponsors`, written by officers.
 *
 * **The price list used to be a commit, and the list of sponsors used to be
 * Prisma Studio.** What a tier costs and what the club promises for it were four
 * objects in `web/src/content/sponsorship.ts` with every amount spelled
 * PLACEHOLDER, under a panel on the public page admitting as much; adding a
 * company that had just signed meant opening a database client. This is both of
 * those becoming a page.
 *
 * **Three sections because the public page has three**, and they are in its
 * order: who backs the club, what backing it costs, and the ways to help that
 * are not money. An officer working here is looking at the page they are
 * writing, top to bottom, rather than at three tables that happen to be related.
 *
 * **Publishing a tier is writing it; unpublishing is deleting it.** There is no
 * draft state and no `published` column, because "we have not settled this yet"
 * and "here is what it costs" are two different rows to have, not two values of
 * one column — and an unpriced tier is absent from the public sheet rather than
 * quoting a figure nobody agreed to. The same rule the front-page slideshow
 * follows: empty is a supported state and the page says so.
 *
 * A sponsor, by contrast, is **hidden rather than deleted** nearly every time. A
 * sponsorship that has run out is a fact about a year, not a reason to erase the
 * club's record of who paid for the rover — so HIDE is the ordinary way off the
 * list and the ✕ is for a typo.
 */
export function OfficerSponsorsPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, the order every other desk uses: a lapsed officer is
  // still an officer, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · SPONSORS" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · SPONSORS" why="Who the club thanks in public, and what a sponsorship costs, is board business." />
  }

  return <Desk />
}

const button =
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-40'

const dangerButton =
  'btn btn-outline h-auto min-h-0 border-error/40 px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-error hover:border-error hover:bg-error/10 hover:text-error disabled:opacity-40'

const panelLabel =
  'text-faint font-mono text-[10px] font-medium tracking-[0.16em]'

/** The quiet text buttons that sit inside a row rather than under it. */
const rowAction =
  'cursor-pointer px-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'

function Desk() {
  const [desk, setDesk] = useState<ApiSponsorDesk | null>(null)
  const [loadError, setLoadError] = useState('')

  /**
   * One read for the whole desk, matching the route: three fetches would be
   * three loading states for a screen that means nothing with any of them
   * missing. Each section below then patches its own slice of it, so a save in
   * one never redraws the other two out from under somebody mid-sentence.
   */
  useEffect(() => {
    const controller = new AbortController()

    getJson<ApiSponsorDesk>('/officer/sponsors', controller.signal)
      .then(setDesk)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error(error)
        setLoadError(
          error instanceof ApiError && error.status === 0
            ? "We couldn't reach the server."
            : "We couldn't load the sponsor page.",
        )
      })

    return () => {
      controller.abort()
    }
  }, [])

  if (desk === null) {
    return (
      <>
        <FormEyebrow>/ MANAGE · SPONSORS</FormEyebrow>
        <FormHeading>Who backs the club.</FormHeading>
        <p
          aria-busy={loadError === ''}
          className="border-rule bg-base-200 text-faint border p-5 text-[13px]"
        >
          {loadError === '' ? 'Loading…' : loadError}
        </p>
      </>
    )
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · SPONSORS</FormEyebrow>
      <FormHeading>Who backs the club, and what that costs.</FormHeading>

      <div className="grid-fluid mb-6 grid items-start gap-6 [--col-min:26rem]">
        <SponsorList
          sponsors={desk.sponsors}
          tiers={desk.tiers.map(({ tier }) => tier)}
          onChange={(sponsors) => {
            setDesk({ ...desk, sponsors })
          }}
        />

        <div className="space-y-6">
          <TierSheet
            tiers={desk.tiers}
            onChange={(tiers) => {
              setDesk({ ...desk, tiers })
            }}
          />

          <FinePrint
            footnotes={desk.footnotes}
            onChange={(footnotes) => {
              setDesk({ ...desk, footnotes })
            }}
          />

          <InKindList
            rows={desk.inKind}
            onChange={(inKind) => {
              setDesk({ ...desk, inKind })
            }}
          />
        </div>
      </div>
    </>
  )
}

// -------------------------------------------------------------- the sponsors

/**
 * A logo chosen before the row it belongs to exists.
 *
 * The add form collects one along with the name, because a company that has
 * just signed arrives as a name *and* a PNG in the same email — and a form that
 * takes only half of that leaves the other half to a second act somebody has to
 * remember. Same idea as `DraftImage` on the project create page, and the same
 * two shapes for the same reason: they become two different requests. An
 * address is a column on the sponsor and rides in with the row; a file is a
 * multipart upload against a path that needs the id, so it can only follow.
 *
 * A file carries `previewUrl`, an object URL that **must be revoked** — which is
 * why nothing sets this state without going through the drop below.
 */
type DraftLogo =
  | { kind: 'file'; file: File; previewUrl: string; shrunk: boolean }
  | { kind: 'url'; url: string }

/**
 * What the preview shows: the object URL for a file, the address for a link.
 *
 * Drawn only once the box holds something that could resolve, or the well
 * flickers a broken image through every keystroke of "https://" — which reads
 * as the address being wrong when it is merely half-typed.
 *
 * **The missing scheme is filled in here because the server fills it in too.**
 * `webUrl` in `server/src/core/validate.ts` stores `company.com/logo.png` as
 * `https://company.com/logo.png`, and a preview that stayed blank until the
 * `https://` was typed would be the desk arguing with the route that accepts it.
 */
const draftLogoSrc = (logo: DraftLogo): string | null => {
  if (logo.kind === 'file') return logo.previewUrl

  const typed = logo.url.trim()
  // A root-relative address is one of our own uploads and `imageSrc` owns it;
  // a scheme in front of that would be a URL pointing at nothing.
  const address =
    typed.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(typed)
      ? typed
      : `https://${typed}`

  return /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(address) || isStoredUpload(address)
    ? imageSrc(address)
    : null
}

/**
 * The list itself.
 *
 * Rows write on blur rather than behind a save button, the way the lending desk
 * writes its inventory: an officer here is correcting a URL or fixing a spelling,
 * one field at a time, and a form that has to be submitted turns four
 * corrections into four submissions somebody can forget.
 */
function SponsorList({
  sponsors,
  tiers,
  onChange,
}: {
  sponsors: ApiManagedSponsor[]
  tiers: SponsorTier[]
  onChange: (next: ApiManagedSponsor[]) => void
}) {
  const id = useId()
  const { message, busy, run, setMessage } = useSectionStatus()

  const [query, setQuery] = useState('')
  const [doomed, setDoomed] = useState<ApiManagedSponsor | null>(null)
  /** Whose logo panel is open, if any. One at a time. */
  const [logoFor, setLogoFor] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [tier, setTier] = useState<SponsorTier>(
    // The lowest level, which is where all but a handful of these start. Read
    // off the end of the list rather than named, so the default follows the
    // enum if the club ever adds a rung under it.
    tiers.at(-1) ?? 'ALUMINUM_ALLY',
  )
  const [website, setWebsite] = useState('')
  const [blurb, setBlurb] = useState('')
  const [logo, setLogo] = useState<DraftLogo | null>(null)

  /**
   * Hand the browser back the memory behind a preview.
   *
   * An object URL pins the whole file until it is revoked, so a few logos tried
   * and abandoned while filling the form would otherwise sit in memory for the
   * life of the tab. Read through a ref so leaving the page revokes whatever is
   * held then, rather than the cleanup re-running — and revoking the preview
   * still on screen — every time anything else on this desk changes.
   */
  const held = useRef(logo)
  held.current = logo

  useEffect(
    () => () => {
      if (held.current?.kind === 'file') URL.revokeObjectURL(held.current.previewUrl)
    },
    [],
  )

  const dropLogo = () => {
    if (logo?.kind === 'file') URL.revokeObjectURL(logo.previewUrl)
    setLogo(null)
  }

  /**
   * Shrink the moment a file is picked rather than at send time.
   *
   * It is the same work either way, and doing it here means the logo in the
   * well is the logo that will go up — a file too large to send is found out
   * about while there is still a form to fix it in. It also takes the race out
   * of ADD: the section is busy until the picture is ready, so the button
   * cannot fire against a logo that has not finished being one.
   */
  const chooseLogo = (picked: File) =>
    run(async () => {
      const { file, downscaled } = await downscaleImage(picked)

      dropLogo()
      setLogo({
        kind: 'file',
        file,
        previewUrl: URL.createObjectURL(file),
        shrunk: downscaled,
      })
    })

  // The same search the lending desk carries, for the same reason on top of the
  // obvious one: it is how an officer checks whether a company is already listed
  // before adding it a second time. The server refuses the duplicate either way.
  const shown = sponsors.filter((sponsor) =>
    hits([sponsor.name, sponsor.blurb], query),
  )

  const replace = (updated: ApiManagedSponsor) => {
    onChange(sponsors.map((row) => (row.id === updated.id ? updated : row)))
  }

  const patch = (sponsor: ApiManagedSponsor, body: Record<string, unknown>) =>
    run(async () => {
      replace(await patchJson<ApiManagedSponsor>(`/officer/sponsors/${sponsor.id}`, body))
    })

  const add = () =>
    run(async () => {
      const added = await postJson<ApiManagedSponsor>('/officer/sponsors', {
        name: name.trim(),
        tier,
        websiteUrl: website.trim() || null,
        blurb: blurb.trim() || null,
        // An address is one of this row's own columns, so it goes up in the
        // create — a sponsor listed by link is one request, and a link the
        // server refuses takes the whole add down with it rather than leaving
        // a row behind with a bad URL on it.
        ...(logo?.kind === 'url' ? { logoUrl: logo.url.trim() } : {}),
      })

      let listed = added
      let stalled = ''

      if (logo?.kind === 'file') {
        const body = new FormData()
        body.append('file', logo.file)

        try {
          listed = await postForm<ApiManagedSponsor>(
            `/officer/sponsors/${added.id}/logo`,
            body,
          )
        } catch (error) {
          // **This cannot throw.** The sponsor exists by now, so a failure that
          // escaped would leave the row unlisted and the form still full —
          // and the next press would be the same company a second time, which
          // the server refuses as a duplicate. The upload is the part that
          // failed, so the upload is the part that gets retried, in the panel
          // this opens below.
          stalled = explainApiError(error)
        }
      }

      onChange([...sponsors, listed])
      setName('')
      setWebsite('')
      setBlurb('')
      dropLogo()
      // The search is cleared too, or a company added while the list is
      // narrowed lands outside it — which looks exactly like an add that did
      // nothing, right up until somebody adds it a second time.
      setQuery('')
      // Straight into the logo panel when the row still has no logo: a company
      // that has just been added is a company whose logo is sitting in
      // somebody's downloads folder. One that arrived with its logo needs
      // nothing next, and an opened panel would only say so.
      setLogoFor(listed.logoUrl === null ? listed.id : null)

      if (stalled !== '') {
        setMessage(
          `${listed.name} is listed, but the logo did not go up. ${stalled} The box for it is open below.`,
        )
      }
    })

  const remove = (sponsor: ApiManagedSponsor) =>
    run(async () => {
      await deleteJson(`/officer/sponsors/${sponsor.id}`)
      onChange(sponsors.filter((row) => row.id !== sponsor.id))
      setDoomed(null)
    })

  return (
    <section>
      <p className={`${panelLabel} mb-4`}>/ SPONSORS</p>

      <div className="border-rule bg-base-200 mb-4 border p-4">
        <p className="text-dim text-[13px] leading-[1.6] text-pretty">
          <strong className="text-base-content font-semibold">Hiding</strong> takes
          a sponsor off the front page and off <code>/sponsors</code> and keeps the
          row — which is what a sponsorship that has run out wants.{' '}
          <strong className="text-base-content font-semibold">Deleting</strong> is
          for a typo. The order on the public page is the tier, then the name;
          there is nothing to drag.
        </p>
      </div>

      {sponsors.length > 0 && (
        <div className="mb-4">
          <label htmlFor={`${id}-find`} className="sr-only">
            Search the sponsors
          </label>
          <input
            id={`${id}-find`}
            type="search"
            value={query}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Search — is this company already here?"
            className={fieldClass}
          />
        </div>
      )}

      {sponsors.length === 0 ? (
        <p className="bg-hatch border-rule text-faint flex h-28 w-full items-center justify-center border font-mono text-[11px] font-medium tracking-[0.14em]">
          [ NOBODY LISTED YET ]
        </p>
      ) : shown.length === 0 ? (
        <p className="text-dim text-sm leading-[1.7]">
          Nothing matches “{query.trim()}”. If they back the club, add them below.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((sponsor) => (
            <li
              key={sponsor.id}
              className={`border-rule bg-base-200 border p-2 ${
                sponsor.active ? '' : 'opacity-60'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <LogoWell
                  src={sponsor.logoUrl === null ? null : imageSrc(sponsor.logoUrl)}
                />

                <input
                  type="text"
                  defaultValue={sponsor.name}
                  maxLength={120}
                  aria-label={`Name of ${sponsor.name}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== '' && next !== sponsor.name) {
                      void patch(sponsor, { name: next })
                    } else {
                      // Put the box back rather than leaving a blank one
                      // sitting there looking saved.
                      event.target.value = sponsor.name
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-40 text-[13px]"
                />

                <select
                  value={sponsor.tier}
                  aria-label={`Tier for ${sponsor.name}`}
                  disabled={busy}
                  onChange={(event) => {
                    void patch(sponsor, { tier: event.target.value })
                  }}
                  className="select border-rule bg-base-100 h-9 min-h-0 shrink-0 text-[12px]"
                >
                  {tiers.map((value) => (
                    <option key={value} value={value}>
                      {tierLabel(value)}
                    </option>
                  ))}
                </select>

                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={logoFor === sponsor.id}
                    disabled={busy}
                    onClick={() => {
                      setLogoFor(logoFor === sponsor.id ? null : sponsor.id)
                    }}
                    className={`${rowAction} ${
                      logoFor === sponsor.id
                        ? 'text-primary'
                        : 'text-faint hover:text-primary'
                    }`}
                  >
                    LOGO
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void patch(sponsor, { active: !sponsor.active })}
                    className={`${rowAction} text-faint hover:text-primary`}
                  >
                    {sponsor.active ? 'HIDE' : 'SHOW'}
                  </button>

                  <button
                    type="button"
                    aria-label={`Delete ${sponsor.name}`}
                    disabled={busy}
                    onClick={() => {
                      setDoomed(sponsor)
                    }}
                    className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                  >
                    ✕
                  </button>
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="url"
                  defaultValue={sponsor.websiteUrl ?? ''}
                  maxLength={500}
                  placeholder="https://… (optional)"
                  aria-label={`Website for ${sponsor.name}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== (sponsor.websiteUrl ?? '')) {
                      void patch(sponsor, { websiteUrl: next || null })
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-52 text-[13px]"
                />

                <input
                  type="text"
                  defaultValue={sponsor.blurb ?? ''}
                  maxLength={300}
                  placeholder="One line about what they give (optional)"
                  aria-label={`Blurb for ${sponsor.name}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== (sponsor.blurb ?? '')) {
                      void patch(sponsor, { blurb: next || null })
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-60 text-[13px]"
                />
              </div>

              {logoFor === sponsor.id && (
                <LogoPanel sponsor={sponsor} onSaved={replace} />
              )}

              {!sponsor.active && (
                <p className="text-faint mt-2 font-mono text-[10px] font-medium tracking-[0.14em]">
                  HIDDEN — NOT ON THE SITE
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-3">
        <p className={panelLabel}>/ ADD A SPONSOR</p>

        <div>
          <label className={labelClass} htmlFor={`${id}-name`}>
            NAME
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1 basis-40">
            <label className={labelClass} htmlFor={`${id}-tier`}>
              TIER
            </label>
            <select
              id={`${id}-tier`}
              value={tier}
              disabled={busy}
              onChange={(event) => {
                setTier(event.target.value as SponsorTier)
              }}
              className="select border-rule bg-base-200 w-full text-sm"
            >
              {tiers.map((value) => (
                <option key={value} value={value}>
                  {tierLabel(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-1 basis-52">
            <label className={labelClass} htmlFor={`${id}-website`}>
              WEBSITE (OPTIONAL)
            </label>
            <input
              id={`${id}-website`}
              type="url"
              value={website}
              maxLength={500}
              placeholder="https://…"
              disabled={busy}
              onChange={(event) => {
                setWebsite(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-blurb`}>
            ONE LINE ABOUT THEM (OPTIONAL)
          </label>
          <input
            id={`${id}-blurb`}
            type="text"
            value={blurb}
            maxLength={300}
            disabled={busy}
            onChange={(event) => {
              setBlurb(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <LogoChoice
          id={`${id}-logo`}
          logo={logo}
          busy={busy}
          onChoose={(picked) => void chooseLogo(picked)}
          onType={(url) => {
            dropLogo()
            setLogo(url.trim() === '' ? null : { kind: 'url', url })
          }}
          onDrop={dropLogo}
        />

        <div>
          {/* Two buttons on this page say ADD and they do different things.
              The visible word stays short — the label above the form is what a
              sighted reader is going by — and the accessible name carries the
              rest, so somebody tabbing through or listing the buttons is not
              choosing between two identical ones. */}
          <button
            type="button"
            aria-label="Add a sponsor"
            disabled={busy || name.trim() === ''}
            onClick={() => void add()}
            className={button}
          >
            ADD
          </button>
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            {logo
              ? 'The logo goes up with them.'
              : 'The logo can wait — adding a sponsor opens the box for it.'}
          </p>
        </div>
      </div>

      <Status message={message} />

      {doomed && (
        <ConfirmDialog
          title={`Delete ${doomed.name}?`}
          confirmLabel="DELETE"
          busy={busy}
          onConfirm={() => void remove(doomed)}
          onDismiss={() => {
            setDoomed(null)
          }}
        >
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            {/* One expression rather than a sentence split around a
                conditional: JSX joins adjacent lines with a space, so a
                full stop on its own line arrives as " ." */}
            {doomed.logoUrl !== null && isStoredUpload(doomed.logoUrl)
              ? 'This removes the row for good, and the logo file with it.'
              : 'This removes the row for good.'}{' '}
            If the sponsorship has simply run out, HIDE keeps the record and takes
            them off the site just the same.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

/**
 * The logo well, at desk size.
 *
 * Drawn whether or not there is artwork in it, and with the same
 * `object-contain` the public card uses — a wordmark cropped to fill would look
 * like a mistake out there, and this is what an officer checks it against. The
 * empty state is the hatch, which is what the public card falls back to as well.
 *
 * One component rather than two copies because the second caller is the add
 * form, and a picture that previewed differently from the way it will be listed
 * would defeat the point of previewing it.
 */
function LogoWell({ src }: { src: string | null }) {
  return (
    <span
      className={`border-rule flex h-12 w-20 shrink-0 items-center justify-center border p-1 ${
        src ? 'bg-base-100' : 'bg-hatch'
      }`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="text-faint font-mono text-[8px] font-medium tracking-[0.14em]">
          [ LOGO ]
        </span>
      )}
    </span>
  )
}

/**
 * The line under the picker.
 *
 * The branch that earns its place is the empty well: a link the preview cannot
 * draw is either half-typed or wrong, and without a word about it the well
 * looks broken rather than waiting. It says what an address looks like rather
 * than demanding `https://`, because the route no longer does either. A nudge
 * and not a block — the field is optional and ADD stays live.
 */
const hint = (logo: DraftLogo | null): string => {
  if (logo?.kind === 'url' && draftLogoSrc(logo) === null) {
    return 'Nothing to preview yet — an address looks like company.com/logo.png'
  }

  if (logo?.kind === 'file' && logo.shrunk) {
    return 'Ready — the picture was shrunk on the way. Nothing is sent until ADD.'
  }

  return 'A transparent PNG sits best — the card behind it changes colour with the theme. Nothing is sent until ADD.'
}

/**
 * The logo half of the add form: a picture settled before the company exists.
 *
 * The desk used to take the name first and the logo strictly second — the add
 * created the row and opened `LogoPanel` on it — which is two acts for one
 * email and leaves a company on the public page with `[ LOGO ]` where their
 * mark should be for as long as it takes somebody to come back to it.
 *
 * **Nothing here sends anything.** A file is shrunk and held; a link is text.
 * Both land in `add`, which is what makes this a preview rather than a save —
 * and why the well beside the controls is the same one the rows draw.
 */
function LogoChoice({
  id,
  logo,
  busy,
  onChoose,
  onType,
  onDrop,
}: {
  id: string
  logo: DraftLogo | null
  busy: boolean
  onChoose: (file: File) => void
  onType: (url: string) => void
  onDrop: () => void
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        LOGO (OPTIONAL)
      </label>

      <div className="flex flex-wrap items-start gap-3">
        <LogoWell src={logo === null ? null : draftLogoSrc(logo)} />

        <div className="grid min-w-0 flex-1 basis-60 gap-2">
          <input
            id={id}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            disabled={busy}
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              // Cleared before the file is used rather than after, so choosing
              // the *same* file again still fires a change event — an input
              // whose value has not moved does not emit one, which is how a
              // second attempt silently does nothing.
              event.target.value = ''
              if (chosen) onChoose(chosen)
            }}
            className="file-input border-rule bg-base-200 w-full text-sm"
          />

          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              // The two ways in are one field: typing an address drops a file
              // that was chosen, and choosing a file empties this. A sponsor
              // has one logo, and a form that let both be filled would have to
              // decide which won without saying so.
              value={logo?.kind === 'url' ? logo.url : ''}
              maxLength={500}
              placeholder="https://… (or a link to one)"
              aria-label="Or a link to the logo"
              disabled={busy}
              onChange={(event) => {
                onType(event.target.value)
              }}
              className="input border-rule bg-base-200 h-9 min-h-0 min-w-0 flex-1 basis-52 text-[13px]"
            />

            {logo && (
              <button
                type="button"
                disabled={busy}
                onClick={onDrop}
                className={`${rowAction} text-faint hover:text-error`}
              >
                REMOVE
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">{hint(logo)}</p>
    </div>
  )
}

/**
 * The logo, which is the one field here that is a file rather than a sentence.
 *
 * Its own component with its own status line because it is the only thing on the
 * row that can fail slowly — an upload is seconds where every other control is a
 * PATCH — and a spinner shared with the name box would freeze the whole row
 * while a 4 MB PNG went up.
 *
 * Choosing a file *is* the upload. A picker already ends in a deliberate act,
 * and a confirm step after it asks the same question twice.
 */
function LogoPanel({
  sponsor,
  onSaved,
}: {
  sponsor: ApiManagedSponsor
  onSaved: (updated: ApiManagedSponsor) => void
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')

  const upload = (chosen: File) =>
    run(async () => {
      const { file, downscaled } = await downscaleImage(chosen)

      const body = new FormData()
      body.append('file', file)

      onSaved(
        await postForm<ApiManagedSponsor>(`/officer/sponsors/${sponsor.id}/logo`, body),
      )
      setNote(downscaled ? 'Saved — the picture was shrunk on the way.' : 'Saved.')
    })

  const link = () =>
    run(async () => {
      onSaved(
        await patchJson<ApiManagedSponsor>(`/officer/sponsors/${sponsor.id}`, {
          logoUrl: url.trim(),
        }),
      )
      setUrl('')
      setNote('Saved.')
    })

  const clear = () =>
    run(async () => {
      onSaved(
        await deleteJson<ApiManagedSponsor>(`/officer/sponsors/${sponsor.id}/logo`),
      )
      setNote('')
    })

  return (
    <div className="border-rule bg-base-100 mt-2 border p-3">
      <div className="grid gap-3">
        <div>
          <label className={labelClass} htmlFor={`${id}-file`}>
            LOGO FROM YOUR COMPUTER
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            disabled={busy}
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              // Cleared before the upload rather than after, so choosing the
              // *same* file again still fires a change event — an input whose
              // value has not moved does not emit one, which is how a retry
              // after a failure silently does nothing.
              event.target.value = ''
              if (chosen) void upload(chosen)
            }}
            className="file-input border-rule bg-base-200 w-full text-sm"
          />
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            {busy
              ? 'Saving…'
              : 'A transparent PNG sits best — the card behind it changes colour with the theme.'}
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-url`}>
            OR A LINK TO ONE
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${id}-url`}
              type="url"
              value={url}
              maxLength={500}
              placeholder="https://…"
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value)
              }}
              className="input border-rule bg-base-200 h-9 min-h-0 min-w-0 flex-1 basis-52 text-[13px]"
            />
            <button
              type="button"
              disabled={busy || url.trim() === ''}
              onClick={() => void link()}
              className={button}
            >
              USE IT
            </button>
          </div>
        </div>

        {sponsor.logoUrl && (
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className={dangerButton}
            >
              REMOVE THE LOGO
            </button>
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              {isStoredUpload(sponsor.logoUrl)
                ? 'It was uploaded here, so this deletes the file.'
                : 'It is hosted elsewhere — this only stops the site showing it.'}
            </p>
          </div>
        )}
      </div>

      <Status message={message} />
      {message === '' && note !== '' && <Status message={note} tone="ok" />}
    </div>
  )
}

// ------------------------------------------------------------- the price list

/**
 * What each level costs, one block per tier.
 *
 * Every level gets a block whether or not it is published, because the row an
 * officer needs in order to publish a tier is exactly the one a filtered list
 * would hide. How many blocks there are comes from the server — see
 * `ApiSponsorDesk` — so a fifth tier added to the schema draws a fifth block
 * with nothing edited here.
 *
 * Saved on a button rather than on blur, which is the opposite of the sponsor
 * rows above and deliberate: a tier is three fields that are one statement, and
 * an amount that saved itself while the benefits under it still said last year's
 * thing would be a public price list mid-edit.
 */
function TierSheet({
  tiers,
  onChange,
}: {
  tiers: { tier: SponsorTier; offer: ApiTierOffer | null }[]
  onChange: (next: { tier: SponsorTier; offer: ApiTierOffer | null }[]) => void
}) {
  const published = tiers.filter(({ offer }) => offer !== null).length

  return (
    <section>
      <p className={`${panelLabel} mb-4`}>/ WHAT A SPONSORSHIP COSTS</p>

      <div className="border-rule bg-base-200 mb-4 border p-4">
        <p className="text-dim text-[13px] leading-[1.6] text-pretty">
          A tier appears on <code>/sponsors</code> once it is saved here, and
          nowhere until then — a level nobody has priced is left off the sheet
          rather than shown with a number the club has not agreed to. Companies
          already in a tier are listed above whatever this says.
        </p>
      </div>

      <div className="space-y-2">
        {tiers.map(({ tier, offer }) => (
          <TierBlock
            key={tier}
            tier={tier}
            offer={offer}
            onChange={(next) => {
              onChange(tiers.map((row) => (row.tier === tier ? { tier, offer: next } : row)))
            }}
          />
        ))}
      </div>

      <p className="text-faint mt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
        {published} / {tiers.length} TIERS PUBLISHED
        {published === 0 && ' — THE PAGE POINTS AT THE CONTACT FORM INSTEAD'}
      </p>
    </section>
  )
}

function TierBlock({
  tier,
  offer,
  onChange,
}: {
  tier: SponsorTier
  offer: ApiTierOffer | null
  onChange: (next: ApiTierOffer | null) => void
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()

  /**
   * A draft, keyed on the tier through the parent's `key`, so a save that fails
   * leaves what somebody typed on the screen rather than snapping back to what
   * the server still holds.
   */
  const [amount, setAmount] = useState(offer?.amount ?? '')
  const [blurb, setBlurb] = useState(offer?.blurb ?? '')
  const [benefits, setBenefits] = useState(linesToText(offer?.benefits ?? []))

  const lines = linesFromText(benefits)
  const tooMany = lines.length > MAX_BENEFITS

  const save = () =>
    run(async () => {
      onChange(
        await putJson<ApiTierOffer>(`/officer/sponsors/tiers/${tier}`, {
          amount: amount.trim(),
          blurb: blurb.trim() || null,
          benefits: lines,
        }),
      )
    })

  const unpublish = () =>
    run(async () => {
      await deleteJson(`/officer/sponsors/tiers/${tier}`)
      onChange(null)
      // The boxes keep what was in them. Taking a tier off the page while the
      // club argues about the number is not the same as throwing the wording
      // away, and putting it back should be one press.
    })

  return (
    /* A named region per tier, and the heading is the name. Four blocks carry
       four boxes labelled WHAT IT COSTS, so without this the only way to reach
       one of them — by keyboard, by screen reader or from a test — is to count.
       `aria-labelledby` rather than a repeated `aria-label`, so the name cannot
       drift from the heading it is sitting under. */
    <section
      aria-labelledby={`${id}-tier`}
      className="border-rule bg-base-200 border p-3"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3
          id={`${id}-tier`}
          className="text-primary font-mono text-[11px] font-medium tracking-[0.16em]"
        >
          {tierLabel(tier)}
        </h3>
        <span className={panelLabel}>
          {offer ? 'ON THE PAGE' : 'NOT PUBLISHED'}
        </span>
      </div>

      <div className="grid gap-3">
        <div>
          <label className={labelClass} htmlFor={`${id}-amount`}>
            WHAT IT COSTS
          </label>
          <input
            id={`${id}-amount`}
            type="text"
            value={amount}
            maxLength={60}
            placeholder="$2,500 a season"
            disabled={busy}
            onChange={(event) => {
              setAmount(event.target.value)
            }}
            className="input border-rule bg-base-100 h-9 min-h-0 w-full text-[13px]"
          />
          {/* Free text on purpose, and worth saying: an officer typing into a
              box marked "cost" will otherwise assume it wants a number and
              leave out the half that makes it mean something. */}
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            Printed exactly as written — “$500+”, “In kind, by arrangement” and
            “$2,500 a season” are all fine.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-blurb`}>
            WHO THE TIER IS FOR (OPTIONAL)
          </label>
          <input
            id={`${id}-blurb`}
            type="text"
            value={blurb}
            maxLength={300}
            disabled={busy}
            onChange={(event) => {
              setBlurb(event.target.value)
            }}
            className="input border-rule bg-base-100 h-9 min-h-0 w-full text-[13px]"
          />
          {/* Optional, and said so on the field rather than left to be
              discovered by pressing PUBLISH. The club's own sheet is an amount
              over a list of what you get, so most of these are blank, and a box
              that looks required is one somebody writes a sentence into to get
              past it. */}
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            Most tiers leave this empty — the amount and the list below usually
            say it.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor={`${id}-benefits`}>
            WHAT THE CLUB GIVES BACK — ONE PER LINE
          </label>
          <textarea
            id={`${id}-benefits`}
            value={benefits}
            rows={4}
            disabled={busy}
            onChange={(event) => {
              setBenefits(event.target.value)
            }}
            className="textarea border-rule bg-base-100 w-full text-[13px]"
          />
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            {lines.length} / {MAX_BENEFITS} lines
            {tooMany && ' — too many; the shortest ones first read best.'}
            {lines.length === 0 &&
              ' — an amount and a sentence is a perfectly good offer.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || tooMany || amount.trim() === ''}
            onClick={() => void save()}
            className={button}
          >
            {offer ? 'SAVE' : 'PUBLISH THIS TIER'}
          </button>

          {offer && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void unpublish()}
              className={dangerButton}
            >
              TAKE IT OFF THE PAGE
            </button>
          )}
        </div>
      </div>

      <Status message={message} />
    </section>
  )
}

// -------------------------------------------------------------- the fine print

/**
 * What a `*` on a benefit means, and the club's note about a sponsorship being
 * tax-deductible.
 *
 * Under the tier sheet rather than inside it, because that is where it prints:
 * the same marker is cited by two different tiers, so it belongs to the grid
 * and not to any card in it. One box rather than a list of footnotes — they are
 * read as a paragraph and never referenced by number, and a schema that tried to
 * check every `*` had a matching note would be checking prose.
 *
 * Saved on a button and not on blur, like the tiers above and for the same
 * reason: it is one statement, and half of it published is worse than none.
 */
function FinePrint({
  footnotes,
  onChange,
}: {
  footnotes: string | null
  onChange: (next: string | null) => void
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()
  const [text, setText] = useState(footnotes ?? '')

  const save = () =>
    run(async () => {
      const saved = await putJson<{ footnotes: string | null }>(
        '/officer/sponsors/sheet',
        { footnotes: text.trim() },
      )
      onChange(saved.footnotes)
    })

  return (
    <section>
      <p className={`${panelLabel} mb-4`}>/ FINE PRINT</p>

      <div className="border-rule bg-base-200 border p-3">
        <label className={labelClass} htmlFor={`${id}-notes`}>
          PRINTED UNDER THE TIERS
        </label>
        <textarea
          id={`${id}-notes`}
          value={text}
          rows={4}
          maxLength={1000}
          placeholder="* What the asterisk on a benefit means"
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value)
          }}
          className="textarea border-rule bg-base-100 w-full text-[13px]"
        />
        <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
          Line breaks are kept. Emptying this box takes the fine print off the
          page altogether, which is how it was before anybody wrote any.
        </p>

        {/* Named for a screen reader, because the tier blocks above carry a
            SAVE of their own and a list of buttons that reads SAVE, SAVE, SAVE
            says nothing about which is which. The visible word stays short. */}
        <button
          type="button"
          aria-label="Save the fine print"
          disabled={busy || text.trim() === (footnotes ?? '')}
          onClick={() => void save()}
          className={`${button} mt-3`}
        >
          SAVE
        </button>

        <Status message={message} />
      </div>
    </section>
  )
}

// ------------------------------------------------------- the other ways to help

/**
 * The half of the pitch a price list cannot carry: machine time, materials, an
 * engineer for an hour a month.
 *
 * Ordered by hand, because these are not ranked by anything the database knows —
 * which one to lead with is whatever the club is short of this semester.
 */
function InKindList({
  rows,
  onChange,
}: {
  rows: ApiInKindOffer[]
  onChange: (next: ApiInKindOffer[]) => void
}) {
  const id = useId()
  const { message, busy, setMessage, run } = useSectionStatus()

  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')

  const full = rows.length >= MAX_IN_KIND

  /**
   * The reorder is debounced, and it is the one debounce here that earns itself:
   * the route takes the *whole* order, so it is idempotent and a lost
   * intermediate press costs nothing, while four arrow presses in a row would
   * otherwise be four writes. Lifted straight from the front-page desk.
   */
  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
    },
    [],
  )

  const reorder = (next: ApiInKindOffer[]) => {
    onChange(next)
    setMessage('')

    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      patchJson<ApiInKindOffer[]>('/officer/sponsors/in-kind/order', {
        ids: next.map((row) => row.id),
      })
        .then(onChange)
        .catch((error: unknown) => {
          setMessage(explainApiError(error))
        })
    }, 600)
  }

  const patch = (row: ApiInKindOffer, body: Record<string, unknown>) =>
    run(async () => {
      const updated = await patchJson<ApiInKindOffer>(
        `/officer/sponsors/in-kind/${row.id}`,
        body,
      )
      onChange(rows.map((one) => (one.id === row.id ? updated : one)))
    })

  const add = () =>
    run(async () => {
      const added = await postJson<ApiInKindOffer>('/officer/sponsors/in-kind', {
        title: title.trim(),
        blurb: blurb.trim(),
      })
      onChange([...rows, added])
      setTitle('')
      setBlurb('')
    })

  const remove = (row: ApiInKindOffer) =>
    run(async () => {
      await deleteJson(`/officer/sponsors/in-kind/${row.id}`)
      onChange(rows.filter((one) => one.id !== row.id))
    })

  return (
    <section>
      <p className={`${panelLabel} mb-4`}>/ OTHER WAYS TO HELP</p>

      <div className="border-rule bg-base-200 mb-4 border p-4">
        <p className="text-dim text-[13px] leading-[1.6] text-pretty">
          The things a sponsor can give that are not money. With none of these
          the section is left off <code>/sponsors</code> altogether rather than
          drawn empty — nothing is broken by that.
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.id} className="border-rule bg-base-200 border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  defaultValue={row.title}
                  maxLength={80}
                  aria-label={`Title of way ${index + 1}`}
                  disabled={busy}
                  onBlur={(event) => {
                    const next = event.target.value.trim()
                    if (next !== '' && next !== row.title) {
                      void patch(row, { title: next })
                    } else {
                      event.target.value = row.title
                    }
                  }}
                  className="input border-rule bg-base-100 h-9 min-h-0 min-w-0 flex-1 basis-40 text-[13px]"
                />

                <span className="flex shrink-0 items-center gap-1">
                  <MoveButton
                    label={`Move way ${index + 1} earlier`}
                    glyph="‹"
                    disabled={index === 0 || busy}
                    onClick={() => {
                      reorder(moveItem(rows, index, index - 1))
                    }}
                  />
                  <MoveButton
                    label={`Move way ${index + 1} later`}
                    glyph="›"
                    disabled={index === rows.length - 1 || busy}
                    onClick={() => {
                      reorder(moveItem(rows, index, index + 1))
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove way ${index + 1}`}
                    disabled={busy}
                    onClick={() => void remove(row)}
                    className="text-faint hover:text-error flex size-11 cursor-pointer items-center justify-center text-sm transition-colors duration-200 disabled:opacity-50 wide:size-8"
                  >
                    ✕
                  </button>
                </span>
              </div>

              <input
                type="text"
                defaultValue={row.blurb}
                maxLength={300}
                aria-label={`Description of way ${index + 1}`}
                disabled={busy}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  if (next !== '' && next !== row.blurb) {
                    void patch(row, { blurb: next })
                  } else {
                    event.target.value = row.blurb
                  }
                }}
                className="input border-rule bg-base-100 mt-2 h-9 min-h-0 w-full text-[13px]"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1 basis-40">
            <label className={labelClass} htmlFor={`${id}-title`}>
              WHAT IT IS
            </label>
            <input
              id={`${id}-title`}
              type="text"
              value={title}
              maxLength={80}
              placeholder="Machine time"
              disabled={busy || full}
              onChange={(event) => {
                setTitle(event.target.value)
              }}
              className={fieldClass}
            />
          </div>

          <div className="min-w-0 flex-1 basis-60">
            <label className={labelClass} htmlFor={`${id}-blurb`}>
              WHAT IT MEANS
            </label>
            <input
              id={`${id}-blurb`}
              type="text"
              value={blurb}
              maxLength={300}
              disabled={busy || full}
              onChange={(event) => {
                setBlurb(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            aria-label="Add a way to help"
            disabled={busy || full || title.trim() === '' || blurb.trim() === ''}
            onClick={() => void add()}
            className={button}
          >
            ADD
          </button>
        </div>
      </div>

      <p className="text-faint mt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
        {rows.length} / {MAX_IN_KIND}
        {full && ' — REMOVE ONE TO ADD ANOTHER'}
      </p>

      <Status message={message} />
    </section>
  )
}

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="border-rule text-dim enabled:hover:border-primary enabled:hover:text-primary flex size-11 cursor-pointer items-center justify-center border text-sm leading-none transition-colors duration-200 disabled:cursor-default disabled:opacity-30 wide:size-8"
    >
      {glyph}
    </button>
  )
}
