import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { SiteLayout } from './SiteLayout'

vi.mock('./SiteNav', () => ({ SiteNav: () => <nav>nav</nav> }))
vi.mock('./SiteFooter', () => ({ SiteFooter: () => <footer>footer</footer> }))

function renderLayout(path = '/members') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="members" element={<button type="button">first control</button>} />
          <Route
            path="dashboard"
            element={
              <>
                <aside>
                  <a href="/dashboard/tasks">TASKS</a>
                </aside>
                <div data-skip-target tabIndex={-1} data-testid="content">
                  <button type="button">first control</button>
                </div>
              </>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('SiteLayout skip link', () => {
  it('comes before the nav', () => {
    renderLayout()

    const skip = screen.getByRole('link', { name: 'SKIP TO CONTENT' })
    const nav = screen.getByRole('navigation')

    expect(skip.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('moves focus into main without putting a hash in the address', () => {
    renderLayout()

    const skip = screen.getByRole('link', { name: 'SKIP TO CONTENT' })
    const event = fireEvent.click(skip)

    expect(screen.getByRole('main')).toHaveFocus()
    // fireEvent returns false once the default action was prevented.
    expect(event).toBe(false)
  })

  it('skips past a section’s own navigation when the page marks where content starts', () => {
    renderLayout('/dashboard')

    fireEvent.click(screen.getByRole('link', { name: 'SKIP TO CONTENT' }))

    expect(screen.getByTestId('content')).toHaveFocus()
  })
})
