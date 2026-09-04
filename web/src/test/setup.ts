import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom is reused across tests in a file, so a component left mounted by one
// test is still in the document for the next one. Unmounting between tests is
// what keeps `getByText` from matching a stale render.
afterEach(() => {
  cleanup()
})

/**
 * jsdom parses `<dialog>` but does not implement opening one.
 *
 * `showModal()` and `close()` are simply absent, so the acknowledgement dialog throws on mount in a
 * test while working in every browser that has shipped since 2022. This is the narrowest thing that
 * closes the gap: flip the `open` attribute, which is what `HTMLDialogElement.open` reflects, and
 * fire the `close` event the component listens for.
 *
 * Everything else a real modal does — the backdrop, focus trapping, Escape, making the page behind
 * inert — is deliberately not faked. jsdom has no layout and no focus model to speak of, so a
 * stand-in would only be something to assert against that no browser had to agree with.
 */
const dialog = globalThis.HTMLDialogElement?.prototype

if (dialog && !dialog.showModal) {
  dialog.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }

  dialog.close = function close(this: HTMLDialogElement, returnValue?: string) {
    this.open = false
    if (returnValue !== undefined) this.returnValue = returnValue
    this.dispatchEvent(new Event('close'))
  }
}
