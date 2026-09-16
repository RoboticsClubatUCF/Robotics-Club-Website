import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { SurveyPromptDialog } from './SurveyPromptDialog'

function renderPrompt() {
  const onClose = vi.fn()
  render(
    <MemoryRouter>
      <SurveyPromptDialog onClose={onClose} />
    </MemoryRouter>,
  )
  return { onClose }
}

const press = (key: string, shiftKey = false) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, shiftKey })
}

describe('SurveyPromptDialog', () => {
  it('keeps Tab inside the prompt', () => {
    renderPrompt()
    const fillIn = screen.getByRole('link', { name: 'FILL IT IN' })
    fillIn.focus()

    press('Tab')

    expect(screen.getByRole('checkbox')).toHaveFocus()

    press('Tab', true)

    expect(fillIn).toHaveFocus()
  })

  /** The tick is read when Escape is pressed, not when the prompt opened. */
  it('honours a tick made after opening when closed with Escape', () => {
    const { onClose } = renderPrompt()

    fireEvent.click(screen.getByRole('checkbox'))
    press('Escape')

    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('closes with Escape unticked', () => {
    const { onClose } = renderPrompt()

    press('Escape')

    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('does not move focus when the box is ticked', () => {
    renderPrompt()
    const box = screen.getByRole('checkbox')
    box.focus()

    fireEvent.click(box)

    expect(box).toHaveFocus()
  })
})
