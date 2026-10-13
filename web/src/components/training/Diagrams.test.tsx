import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { flatten } from '../../lib/training/curriculum'
import { CHAPTERS } from './chapters'
import { CheckStep } from './CheckStep'
import { MushroomDiagram } from './Diagrams'

describe('the mushroom orientation question', () => {
  it('describes the two orientations without identifying the answer', () => {
    render(<MushroomDiagram />)
    const image = screen.getByRole('img')
    expect(image).toHaveAccessibleName('Two orientations of the same mushroom. A, on the left: standing on its stem, cap on top. B, on the right: upside down, cap on the plate.')
    expect(within(image).getByText('A · CAP ON TOP')).toBeInTheDocument()
    expect(within(image).getByText('B · CAP ON PLATE')).toBeInTheDocument()
    expect(image).not.toHaveTextContent(/support|nothing under the cap/i)
  })

  it('only explains support requirements after an answer is chosen', () => {
    const step = flatten(CHAPTERS).find(({ step }) => step.id === 'check-mushroom-orient')?.step
    if (step?.kind !== 'check') throw new Error('Missing mushroom orientation question')
    const onRight = vi.fn()
    render(<CheckStep question={step.question} picture={step.picture} options={step.options} answered={false} onRight={onRight} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    for (const option of step.options) expect(screen.queryByText(option.why)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Standing on its stem, cap on top' }))
    expect(screen.getByRole('status')).toHaveTextContent('That needs supports.')
    expect(onRight).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Upside down, cap on the plate' }))
    expect(screen.getByRole('status')).toHaveTextContent('Every layer sits on the one below')
    expect(onRight).toHaveBeenCalledOnce()
  })
})
