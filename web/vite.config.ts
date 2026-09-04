// `defineConfig` comes from vitest, not vite — it is the same function widened
// to accept the `test` block below. Vitest reuses everything above it, so tests
// run through the same plugin pipeline as the app.
import { defineConfig } from 'vitest/config'
// `loadEnv` is vite's own and is not re-exported by `vitest/config`, which
// only widens `defineConfig`. Both come from the same installed vite.
import { loadEnv, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

/**
 * Say, at the end of every build, which API address went into the bundle.
 *
 * `VITE_API_URL` is substituted at build time, so a build carries whatever the env files said at
 * the moment it ran and there is no way to correct it afterwards — the value is a string literal
 * inside a minified chunk. Ship the wrong one and the deployed site fails in a way that names
 * nothing: an `http` URL on an `https` page is blocked as mixed content before the request is sent,
 * so there is no CORS error, no status code and no server log, just every page rendering its
 * "couldn't reach the server" state.
 *
 * The specific way this goes wrong is a missing `.env.production`. Vite layers that file over
 * `.env` for `vite build` and says nothing when it is not there — it falls back to the development
 * value, `http://localhost:4000`, which on a deployed site means the visitor's own machine. That
 * has happened twice on this project, and both times the build looked completely normal.
 *
 * A warning rather than a hard failure, deliberately: `npm run typecheck` at the repo root runs
 * `vite build`, and so does CI, and neither has any business knowing the club's production
 * hostname. So the check cannot refuse — it can only make the answer impossible to miss, and leave
 * refusing to the deploy step, which greps the built bundle before it copies anything.
 */
function reportApiUrl(mode: string): Plugin {
  return {
    name: 'rccf-report-api-url',
    apply: 'build',
    closeBundle() {
      const url = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL ?? ''
      const local = url === '' || /localhost|127\.0\.0\.1/.test(url)

      if (local) {
        this.warn(
          `\n  ┌─ API address baked into this bundle ─────────────────────────\n` +
            `  │  ${url || '(unset — falls back to http://localhost:4000)'}\n` +
            `  │  LOCAL BUILD. Do not deploy this.\n` +
            `  │  A deployed copy would call the visitor's own machine.\n` +
            `  │  For production: put web/.env.production in place first.\n` +
            `  └──────────────────────────────────────────────────────────────\n`,
        )
        return
      }

      this.info(
        `\n  API address baked into this bundle: ${url}\n` +
          `  (deployable — verify with: grep -o '${url}' dist/assets/*.js)\n`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // Tailwind 4 is a Vite plugin, not a PostCSS step — there is no
    // postcss.config.js and no tailwind.config.js. Everything is configured
    // from src/index.css.
    tailwindcss(),
    reportApiUrl(mode),
  ],
  test: {
    // Components read from the API on mount, so they need a DOM with a real
    // effect cycle — the whole reason this exists. Rendering to a string can't
    // exercise anything past first paint.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The backend lives in server/, which is *inside* this package's directory,
    // so the default include glob sweeps up its tests and tries to run them in
    // jsdom. They have their own runner: server/vitest.config.ts.
    include: ['src/**/*.test.{ts,tsx}'],
    // `expect`, `it` and friends are imported explicitly rather than injected
    // as globals, so nothing has to be added to tsconfig for them to typecheck.
    globals: false,
    css: false,
  },
}))
