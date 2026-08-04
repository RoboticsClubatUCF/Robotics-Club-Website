// `defineConfig` comes from vitest, not vite — it is the same function widened
// to accept the `test` block below. Vitest reuses everything above it, so tests
// run through the same plugin pipeline as the app.
import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // Tailwind 4 is a Vite plugin, not a PostCSS step — there is no
    // postcss.config.js and no tailwind.config.js. Everything is configured
    // from src/index.css.
    tailwindcss(),
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
})
