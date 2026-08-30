import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageFramer } from './ImageFramer'
import { DEFAULT_FRAMING } from '../../lib/media/imageFraming'

function renderFramer(initial = DEFAULT_FRAMING) {
  const onSave = vi.fn()
  const onCancel = vi.fn()

  render(
    <ImageFramer
      url="/api/files/abc123"
      initial={initial}
      busy={false}
      onCancel={onCancel}
      onSave={onSave}
    />,
  )

  return { onSave, onCancel }
}

const preview = () =>
  screen.getByRole('application', {
    name: 'Drag to choose what this picture shows',
  })

const previewImage = () => preview().querySelector('img')!

describe('ImageFramer', () => {
  it('opens on the framing it was given', () => {
    renderFramer({ focalX: 20, focalY: 80, zoom: 2 })

    expect(previewImage().style.objectPosition).toBe('20% 80%')
    expect(previewImage().style.transform).toBe('scale(2)')
    expect(screen.getByText('2.0×')).toBeInTheDocument()
  })

  it('zooms from the slider', () => {
    renderFramer()

    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '2.5' } })

    expect(screen.getByText('2.5×')).toBeInTheDocument()
    expect(previewImage().style.transform).toBe('scale(2.5)')
  })

  /**
   * jsdom gives every element a 0×0 rectangle, so a drag cannot change
   * anything here — which is the point of this test: the guard in `panBy` is
   * what stops that becoming `Infinity` in a style. The arithmetic itself is
   * covered in `imageFraming.test.ts`, where it can be checked against real
   * numbers.
   */
  it('survives a drag in a zero-sized frame without corrupting the style', () => {
    renderFramer()

    fireEvent.pointerDown(preview(), { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(preview(), { clientX: 40, clientY: 60 })
    fireEvent.pointerUp(preview())

    expect(previewImage().style.objectPosition).toBe('50% 50%')
    expect(previewImage().getAttribute('style')).not.toContain('NaN')
  })

  it('saves the framing it is showing, once, on DONE', () => {
    const { onSave } = renderFramer()

    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '1.8' } })
    fireEvent.click(screen.getByRole('button', { name: 'DONE' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ focalX: 50, focalY: 50, zoom: 1.8 })
  })

  /** Nothing is written while it is being moved — a drag would be a request a frame. */
  it('writes nothing until DONE', () => {
    const { onSave } = renderFramer()

    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '3' } })
    fireEvent.pointerDown(preview(), { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(preview(), { clientX: 90, clientY: 90 })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('resets to a plain centred crop, and says so by going quiet', () => {
    renderFramer({ focalX: 10, focalY: 90, zoom: 3 })

    const reset = screen.getByRole('button', { name: 'RESET' })
    expect(reset).toBeEnabled()

    fireEvent.click(reset)

    expect(previewImage().style.objectPosition).toBe('50% 50%')
    expect(previewImage().style.transform).toBe('')
    expect(reset).toBeDisabled()
  })

  it('abandons the change on CANCEL', () => {
    const { onCancel, onSave } = renderFramer()

    fireEvent.change(screen.getByLabelText('ZOOM'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))

    expect(onCancel).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  /** The whole range has to be reachable without a pointer. */
  it('pans with the arrow keys', () => {
    renderFramer()

    fireEvent.keyDown(preview(), { key: 'ArrowRight' })

    // jsdom's zero-sized frame means the value cannot move, but the key must be
    // handled rather than scrolling the page behind the editor.
    expect(previewImage().getAttribute('style')).not.toContain('NaN')
  })
})
