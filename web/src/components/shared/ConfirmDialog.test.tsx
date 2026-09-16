import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

const press = (key: string, shiftKey = false) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, shiftKey })
}

/** An opener outside the dialog and a field inside it, like the delete-account panel. */
function Harness({ onDismiss }: { onDismiss: () => void }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        OPEN
      </button>
      <a href="/behind">A link behind the scrim</a>
      {open && (
        <ConfirmDialog
          title="Delete it?"
          confirmLabel="DELETE IT"
          busy={password === ''}
          onConfirm={() => {}}
          // A fresh closure every render, which is what a caller without the compiler passes.
          onDismiss={() => {
            onDismiss()
            setOpen(false)
          }}
        >
          <label htmlFor="pw">PASSWORD</label>
          <input
            id="pw"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </ConfirmDialog>
      )}
    </>
  )
}

function openDialog() {
  const onDismiss = vi.fn()
  render(<Harness onDismiss={onDismiss} />)
  const opener = screen.getByRole('button', { name: 'OPEN' })
  opener.focus()
  fireEvent.click(opener)
  return { onDismiss, opener }
}

describe('ConfirmDialog focus', () => {
  it('starts on the dismissing button, never the act', () => {
    openDialog()

    expect(screen.getByRole('button', { name: 'GO BACK' })).toHaveFocus()
  })

  /**
   * The confirming button is disabled until a password is typed, so GO BACK is the last stop —
   * and Tab from it used to land on the page behind.
   */
  it('wraps Tab from the last stop to the first', () => {
    openDialog()

    press('Tab')

    expect(screen.getByLabelText('PASSWORD')).toHaveFocus()
  })

  it('wraps Shift+Tab from the first stop to the last', () => {
    openDialog()
    screen.getByLabelText('PASSWORD').focus()

    press('Tab', true)

    expect(screen.getByRole('button', { name: 'GO BACK' })).toHaveFocus()
  })

  it('counts the act once it is enabled', () => {
    openDialog()
    const field = screen.getByLabelText('PASSWORD')
    fireEvent.change(field, { target: { value: 'secret' } })
    screen.getByRole('button', { name: 'DELETE IT' }).focus()

    press('Tab')

    expect(field).toHaveFocus()
  })

  it('pulls focus back in if it has ended up behind the dialog', () => {
    openDialog()
    screen.getByRole('link', { name: 'A link behind the scrim' }).focus()

    press('Tab')

    expect(screen.getByLabelText('PASSWORD')).toHaveFocus()
  })

  it('leaves Tab alone between two stops in the middle', () => {
    openDialog()
    const field = screen.getByLabelText('PASSWORD')
    fireEvent.change(field, { target: { value: 'secret' } })
    field.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    field.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps focus in the field while somebody types, however often the parent renders', () => {
    openDialog()
    const field = screen.getByLabelText('PASSWORD')
    field.focus()

    fireEvent.change(field, { target: { value: 's' } })
    fireEvent.change(field, { target: { value: 'se' } })

    expect(field).toHaveFocus()
  })

  it('closes on Escape and hands focus back to the opener', () => {
    const { onDismiss, opener } = openDialog()

    press('Escape')

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
