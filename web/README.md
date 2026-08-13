# RCCF frontend

Vite 8, React 19.2 with the React Compiler, TypeScript 6, Tailwind 4, DaisyUI 5
and React Router 8. Five routes: the landing page, signup, sign-in, the member
dashboard, and dues — the last three behind a session. Stripe's `PaymentElement`
handles cards, so no card details ever touch this origin.

**Setting up for the first time? Start at the [root README](../README.md)** —
this package needs the API running, and the API needs Postgres before that.

Day to day you want the root command, which starts the database, the API and
this together:

```bash
cd .. && npm run dev
```

The scripts below run this package alone, which is useful when the API is
already up or when you're only touching markup.

```bash
npm install
npm run dev     # http://localhost:5173
```

## Commands

| Command                | Does                                         |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Dev server on :5173                          |
| `npm run build`        | `tsc -b` then build to `dist/`               |
| `npm run preview`      | Serve the built output                       |
| `npm test`             | Component tests, once                        |
| `npm run test:watch`   | Component tests, re-running on save          |
| `npm run lint`         | Oxlint                                       |
| `npm run format`       | Prettier, rewriting files                    |
| `npm run format:check` | Prettier, reporting only                     |

## Layout

```
src/
├── App.tsx           the router
├── index.css         all styling config — theme, tokens, fonts, animations
├── components/
│   ├── layout/       chrome around every route: SiteLayout, SiteNav, SiteFooter
│   ├── home/         the landing page's sections, in page order
│   ├── join/         the signup steps
│   ├── dues/         the membership panel, plan picker and payment form
│   └── shared/       used by more than one page, incl. formChrome
├── content/          page copy: the words, not the data
├── lib/              API client, fetching hook, session context, Stripe loader
├── pages/            one file per route; several are still empty placeholders
└── test/             test setup and fetch stubs
```

## How this is put together

- **Tailwind is configured in CSS.** There is no `tailwind.config.js` and no
  `postcss.config.js` — don't create one. `src/index.css` holds the DaisyUI
  plugin, the club theme, the design tokens, the fonts and the keyframes.
- **One theme, `rccf`, and it is dark.** DaisyUI's built-ins are switched off.
  There is no `dark:` variant anywhere because there is nothing to switch to.
- **Colour never appears as a literal in a component.** `text-dim`,
  `text-faint`, `border-rule`, `bg-wash` and `text-primary` are the palette.
  There is exactly one exception, `components/dues/stripeAppearance.ts`: Stripe's
  payment form renders in an iframe served from stripe.com, which cannot see
  this stylesheet and takes only the values handed to it. Those values are
  copies of the theme and have to be changed alongside it.
- **One breakpoint, `wide` (900px).** Everything responsive keys off it.
- **The API is a separate origin.** `src/lib/api.ts` owns the base URL
  (`VITE_API_URL`, default `http://localhost:4000`) and the response types.
  Those types are written by hand to mirror the server's `select` blocks —
  nothing enforces the match, so change them together.
- **Every remote read renders three states.** Loading is a skeleton sized to
  what it replaces so nothing reflows; failure degrades to an em dash or a short
  message, never to a stale or invented number.
- **Routing is `BrowserRouter`, not a data router.** Nothing loads through a
  route loader — components fetch what they need through `useApi` — so the data
  APIs would be machinery for nothing. Real paths rather than hashes, because
  the signup verification link goes in an email.
- **Nav links carrying a hash stay plain `<a>` tags.** `/#events` from another
  route has to load the front page *and* land on the section, which the browser
  already does; React Router would take the navigation over and then not scroll
  anywhere. Everything else is a `<Link>`.
- **Who is signed in is one context, not a fetch per component.** `SessionProvider`
  wraps the routes and `useSession` reads it. `useApi` has no cache, so asking
  per component would make the nav flicker from "Sign in" to a name after the
  page below it had settled.
- **Every request sends `credentials: 'include'`.** The API is a different
  origin, so without it `fetch` sends no cookie — and the failure is silent in
  both directions: no CORS error, no server log, just a site that will not stay
  signed in. The server's half is `credentials: true` on its CORS middleware;
  both are required and neither is any use alone.
- **The browser never decides that a payment succeeded.** Stripe's confirm hands
  back an intent id and nothing is inferred from it — the page posts it to
  `/api/dues/sync` and shows whatever the server says. The same is true of the
  `redirect_status` in the URL when a bank sends somebody back here.
- **Prices and dates are never computed here.** Both come from
  `GET /api/dues/status`; `lib/dues.ts` only formats them. A page that worked out
  its own coverage dates would eventually disagree with the one a member was
  charged against, and the member would be right.

## Deploying

**Any path has to serve `index.html`.** The dev server does this already, but a
static host will 404 on `/join` before React ever runs — and `/join?token=…` is
the URL in every signup verification email, `/dashboard/dues?payment_intent=…`
the one a bank returns a member to after authenticating a card. (`/dues` still
resolves, as a redirect that keeps the query string — it was the return URL for
every payment started before dues moved into the dashboard.) On Netlify that is a
`_redirects` line of `/* /index.html 200`; on nginx, `try_files $uri /index.html`.

**`VITE_STRIPE_PUBLISHABLE_KEY` has to ship too**, and from the same Stripe
account as the server's `STRIPE_SECRET_KEY` — mismatched keys fail every payment
with an error that names neither of them. It is not a secret; it can only create
payments, never see or move money. Left unset, the dues page says card payments
aren't switched on and points at an officer, which is a supported state rather
than a broken one.

**Sessions cross the origin only if two settings agree.** The API sends
`credentials: true` on CORS and this package sends `credentials: 'include'`;
beyond that, the server's `SESSION_COOKIE_SAMESITE` must stay `lax` while the
site and the API share a registrable domain (`rccf.org` and `api.rccf.org` do)
and only becomes `none` when they genuinely differ, which requires https.

`VITE_API_URL` is baked in at build time. On the API side, `SITE_URL` is the
single place this site's address is configured — the CORS allow-list and the
verification link in every signup email both come from it.

**Over https, `VITE_API_URL` has to be https too.** A secure page may not call
an insecure one: the browser blocks it as mixed content before the request is
sent, so there is no CORS error and no server log — every call fails exactly as
it would if the API were down, and the whole site renders its "couldn't reach
the server" states. `src/lib/api.ts` logs the mismatch by name if a build ever
ships with it. The API side of moving to https is `SITE_URL` and `TRUST_PROXY`;
see the deploy notes in `.claude/docs/architecture.md`.

The comments in `src/index.css` carry the reasoning behind each of those
decisions, including the ones that have already cost time.

## Tests

```bash
npm test
```

jsdom, Testing Library, and a stubbed `fetch` — nothing needs to be running, not
the API and not the database. They exist to cover what `tsc` and a build cannot:
that the page behaves when the network doesn't.

```
src/components/home/StatStrip.test.tsx          loading, ready, unreachable, links
src/components/projects/ProjectsSection.test.tsx rows, empty list, missing fields
src/components/join/DiscordUsernameField.test.tsx  every answer the check can give
src/components/join/SignupStart.test.tsx        eligibility, the restart cooldown
src/components/join/SignupFinish.test.tsx       what is sent, and the agreement
src/pages/JoinPage.test.tsx                     which screen a token gets you
src/pages/LoginPage.test.tsx                    one refusal for every failure
src/pages/DuesPage.test.tsx                     plans, and landing back from a bank
src/components/dues/MembershipPanel.test.tsx    the four states, each with its date
```

Two of those exist for rules that are easy to lose in a refactor and invisible
in a screenshot:

- **`DuesPage` offers both plans in every state**, including the two where
  nothing is owed. Somebody on the free trial, or reading it in a free summer,
  has to be able to settle the term ahead rather than being told to come back.
- **Landing on `/dues?payment_intent=…` confirms exactly once**, even though the
  effect clears the query string out from under itself and StrictMode
  double-invokes. Confirming twice is the shape of a double-credit bug.

When adding one, reach for `src/test/stubFetch.ts` — it has helpers for a
successful response, a network failure, and a request that never settles. Every
stub declares its `init` parameter even when it ignores it; without that,
`mock.calls` types as a one-element tuple and a test that wants to assert on
what was posted can only reach it through a cast.

Anything rendering a page that reads the session needs `SessionProvider` around
it as well as a router — `useSession` throws outside one, deliberately, because
a component silently rendering its anonymous version for ever is a wiring bug
that looks like a session bug.
