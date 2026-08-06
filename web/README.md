# RCCF frontend

Vite 8, React 19.2 with the React Compiler, TypeScript 6, Tailwind 4, DaisyUI 5
and React Router 8. Two routes so far: the landing page and signup.

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
│   └── shared/       used by more than one page
├── content/home.ts   page copy: the words, not the data
├── lib/              API client and the fetching hook
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

## Deploying

**Any path has to serve `index.html`.** The dev server does this already, but a
static host will 404 on `/join` before React ever runs — and `/join?token=…` is
the URL in every signup verification email. On Netlify that is a `_redirects`
line of `/* /index.html 200`; on nginx, `try_files $uri /index.html`.

`VITE_API_URL` is baked in at build time, and the API's `SIGNUP_VERIFY_URL` has
to point back at this site's `/join`.

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
src/pages/JoinPage.test.tsx                     which screen a token gets you
```

When adding one, reach for `src/test/stubFetch.ts` — it has helpers for a
successful response, a network failure, and a request that never settles.
