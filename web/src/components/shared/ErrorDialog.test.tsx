import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorDialog } from './ErrorDialog'

/**
 * The shell's own behaviour. What each page says in it is tested on that page.
 */

function Harness({ returnTo }: { returnTo?: boolean }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<HTMLInputElement | null>(null)

  return (
    <>
      <input ref={setField} aria-label="Grams" />
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        MARK DONE
      </button>
      {open && (
        <ErrorDialog
          title="Couldn't mark it done."
          returnTo={returnTo ? field : null}
          onDismiss={() => {
            setOpen(false)
          }}
        >
          <p>This request is already settled.</p>
        </ErrorDialog>
      )}
    </>
  )
}

const open = () => {
  const opener = screen.getByRole('button', { name: 'MARK DONE' })
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('ErrorDialog', () => {
  it('is announced as an alert with its title and message', () => {
    render(<Harness />)
    open()

    const dialog = screen.getByRole('alertdialog', { name: "Couldn't mark it done." })
    expect(dialog).toHaveAccessibleDescription('This request is already settled.')
  })

  it('starts on OK and keeps Tab there', () => {
    render(<Harness />)
    open()

    const ok = screen.getByRole('button', { name: 'OK' })
    expect(ok).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(ok).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(ok).toHaveFocus()
  })

  it('hands focus back to whatever opened it', () => {
    render(<Harness />)
    const opener = open()

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('sends focus to the field it is about, when given one', () => {
    render(<Harness returnTo />)
    open()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Grams')).toHaveFocus()
  })

  it('falls back to the opener when the field has left the page', () => {
    const gone = document.createElement('input')
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const { unmount } = render(
      <ErrorDialog title="Couldn't mark it done." returnTo={gone} onDismiss={() => {}}>
        <p>This request is already settled.</p>
      </ErrorDialog>,
    )
    unmount()

    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('closes on the backdrop only when the press started there', () => {
    const onDismiss = vi.fn()
    render(
      <ErrorDialog title="Couldn't mark it done." onDismiss={onDismiss}>
        <p>This request is already settled.</p>
      </ErrorDialog>,
    )

    const backdrop = screen.getByRole('alertdialog').parentElement!
    const message = screen.getByText('This request is already settled.')

    // Selecting the message and letting go over the scrim.
    fireEvent.pointerDown(message)
    fireEvent.click(backdrop)
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
