import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom is reused across tests in a file, so a component left mounted by one
// test is still in the document for the next one. Unmounting between tests is
// what keeps `getByText` from matching a stale render.
afterEach(() => {
  cleanup()
})
