# RCCF frontend

Vite 8, React 19.2 with the React Compiler, TypeScript 6, Tailwind 4, DaisyUI 5
and React Router 8. The public pages plus the `/dashboard` section behind a
session. Stripe's `PaymentElement` handles cards, so card details never touch
this origin.

First time? Start at the [root README](../README.md). This package needs the
API, and the API needs Postgres. Day to day, run `npm run dev` from the root,
which starts all three. The scripts below run this package alone.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :5173 |
| `npm run build` | `tsc -b`, then build to `dist/` |
| `npm run preview` | Serve the build |
| `npm test` | Component tests once |
| `npm run test:watch` | Component tests on save |
| `npm run lint` | Oxlint |
| `npm run format` / `format:check` | Prettier, writing or checking |

`npm run build` is the typecheck. `tsc -b` follows project references into the
tests; `npx tsc --noEmit -p tsconfig.json` doesn't, and passes code CI rejects.
There is no separate `typecheck` script for that reason.

## Layout

```
src/
├── App.tsx           the router
├── index.css         Tailwind config: themes, tokens, fonts, animations
├── components/       by feature: layout, home, join, dues, dashboard, profile,
│                     projects, survey, about, shared
├── content/          nav links, stat cells, social links; the acknowledgement parser
├── lib/              shared rules by feature: api/, auth/, dues/, projects/, media/...
├── pages/            one file per route: public/, auth/, dashboard/, officer/
└── test/             setup and fetch stubs
```

Tests sit beside the file they test.

## Conventions

- Tailwind is configured in `src/index.css`. Don't add `tailwind.config.js` or
  `postcss.config.js`.
- Two themes: `rccf` (dark, default) and `rccf-light`. An inline script in
  `index.html` picks one before first paint. There are no `dark:` variants; the
  tokens change value.
- No colour literals in components. Use `text-base-content`, `text-dim`,
  `text-faint`, `border-rule`, `bg-sink`, `text-primary`. A `text-white` or hex
  is invisible on the light theme and the build won't warn. The one exception is
  `components/dues/stripeAppearance.ts`, because Stripe's iframe can't read this
  stylesheet; keep it in step with the theme.
- One breakpoint, `wide` (900px).
- `src/lib/api/api.ts` owns the API base URL (`VITE_API_URL`, default
  `http://localhost:4000`) and the response types. The types are written by hand
  to match the server; change them together.
- Every remote read renders loading (a skeleton the size of the content),
  failure (a short message, never an invented number) and success.
- `BrowserRouter`, not a data router: components fetch through `useApi`. Real
  paths, because signup links are emailed.
- Nav links with a hash (`/#events`) are plain `<a>` tags so the browser scrolls
  to the section. Everything else is a `<Link>`.
- `SessionProvider` holds who's signed in, read with `useSession`, so the nav
  doesn't flicker.
- Every request sends `credentials: 'include'`, matched by `credentials: true` in
  the API's CORS. Without both, sessions silently don't stick.
- Render image columns through `imageSrc` in `lib/media/storedFiles.ts`. Uploads
  have root-relative URLs on the API's origin.
- The browser never decides a payment succeeded. It posts the payment intent id
  to `/api/dues/sync` and shows the server's answer, including after a bank
  redirect.
- Prices and dates come from `GET /api/dues/status`; `lib/dues/dues.ts` only
  formats them.

## UI copy and optional help

Keep labels and controls sufficient for the task. Omit obvious helper text,
page-purpose introductions and implementation explanations. Useful optional
detail belongs in [`InfoTip`](src/components/shared/InfoTip.tsx) beside the
relevant label or heading; essential decision information and actionable errors
stay visible when relevant. Do not restore removed source labels such as
"By hand" on officer rows.

Reuse the compact SVG and its hover, click/tap and keyboard interactions.
Centre label rows with `items-center gap-1`, put `mb-1.5` on the row and reset
the label's margin with `[&>label]:mb-0` so neighbouring fields stay aligned.
Placeholders are neutral input hints with separate accessible labels.

[`Status`](src/components/shared/Status.tsx) renders nothing without a message.
Remove empty wrappers, reserved height and leftover margins when deleting copy;
check the initial form as well as error and success states. Preserve deliberate
section spacing, skeletons and slicer geometry. Check every caller when changing
shared help or feedback, including conditional editors.

## Placeholder data

The development seed invents officer terms, roster entries and sponsors under
the club's real seat names. They're fine locally and wrong on any public
database. `prisma/seed.ts` refuses to run against a database that holds real
people unless forced. Nothing invented ships in the bundle: page copy, sponsor
tiers and the about page are written by officers on the site.

## Deploying

- Serve `index.html` for every path. `/join?token=…` is in every signup email and
  `/dashboard/dues?payment_intent=…` is where banks return members. (`/dues` still
  redirects there with its query string.) Netlify: `/* /index.html 200`; nginx:
  `try_files $uri /index.html`.
- `VITE_STRIPE_PUBLISHABLE_KEY` must come from the same Stripe account as the
  server's `STRIPE_SECRET_KEY`, or every payment fails. It isn't secret. Unset,
  the dues page says card payments are off.
- `VITE_API_URL` is baked in at build time. On the club's deployment nginx
  serves the site and proxies `/api/` on one origin, so it's
  `https://rccf.club`. A bundle built for a non-existent `api.` host loads and
  fails every request; that has taken the site down once. The deploy agent builds
  on the server, refuses an unset or local value, and logs the URL it bakes in
  ([`../deploy/README.md`](../deploy/README.md)).
- Over https, `VITE_API_URL` must be https too, or the browser blocks every call
  as mixed content with no CORS error or server log. `lib/api/api.ts` logs the
  mismatch. On the API side see `SITE_URL` and `TRUST_PROXY` in
  [`../server/README.md`](../server/README.md).
- Sessions across origins need the server's `SESSION_COOKIE_SAMESITE` to stay
  `lax` while site and API share a registrable domain; `none` only when they
  don't, which requires https.

## Tests

```bash
npm test
```

jsdom, Testing Library and a stubbed `fetch`; nothing needs to be running. They
cover what a build can't: how pages behave when the network doesn't.

A few worth knowing:

- `pages/dashboard/DuesPage.test.tsx` checks both plans show in every state,
  including the free window, and that returning with `?payment_intent=…` confirms
  exactly once despite StrictMode.
- `pages/auth/LoginPage.test.tsx` checks one refusal message for every failure.
- `components/shared/DiscordUsernameField.test.tsx` covers every answer the
  handle check can give.

When adding one, use `src/test/stubFetch.ts` (helpers for success, network
failure and a request that never settles). Declare the stub's `init` parameter
even if unused, or `mock.calls` types too narrowly. Anything reading the session
needs `SessionProvider` and a router around it; `useSession` throws without the
provider on purpose.
