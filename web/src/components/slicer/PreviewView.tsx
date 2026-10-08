import { useEffect, useRef, useState } from 'react'
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three'
import { ROLES, ROLE_LABEL, type Preview, type Role } from '../../lib/slicer/preview'
import type { Bed } from '../../lib/slicer/plateTransform'
import {
  type Stage,
  createStage,
  disposeTree,
  makeBed,
  themeColors,
} from '../../lib/slicer/scene'
import { useTheme } from '../../lib/theme'

/**
 * The sliced plate, layer by layer: Orca's own toolpaths, coloured by what they are. The slider
 * picks the top layer shown; the legend hides a kind of path.
 */
export function PreviewView({ bed, preview }: { bed: Bed; preview: Preview }) {
  const last = preview.layers.length - 1
  const [top, setTop] = useState(last)
  const [hidden, setHidden] = useState<ReadonlySet<Role>>(new Set())

  return (
    <div className="absolute inset-0 flex">
      <div className="relative min-w-0 flex-1">
        <PreviewCanvas bed={bed} preview={preview} top={top} hidden={hidden} />
        <Legend
          hidden={hidden}
          preview={preview}
          onToggle={(role) => {
            const next = new Set(hidden)
            if (next.has(role)) next.delete(role)
            else next.add(role)
            setHidden(next)
          }}
        />
      </div>
      <LayerSlider preview={preview} top={top} onChange={setTop} />
    </div>
  )
}

function PreviewCanvas({
  bed,
  preview,
  top,
  hidden,
}: {
  bed: Bed
  preview: Preview
  top: number
  hidden: ReadonlySet<Role>
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<Stage | null>(null)
  const lines = useRef<Map<Role, LineSegments>>(new Map())
  const bedGroup = useRef<Group | null>(null)
  const theme = useTheme()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!canvas.current || !host.current) return
    const made = createStage(canvas.current, host.current, bed)
    if (!made) {
      setFailed(true)
      return
    }
    stage.current = made
    const paths = lines.current
    for (const role of ROLES) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(preview.roles[role].positions, 3))
      const segments = new LineSegments(geometry, new LineBasicMaterial())
      segments.frustumCulled = false
      paths.set(role, segments)
      made.scene.add(segments)
    }
    return () => {
      for (const segments of paths.values()) {
        segments.geometry.dispose()
        ;(segments.material as LineBasicMaterial).dispose()
      }
      paths.clear()
      if (bedGroup.current) disposeTree(bedGroup.current)
      bedGroup.current = null
      made.dispose()
      stage.current = null
    }
  }, [bed, preview])

  useEffect(() => {
    const made = stage.current
    if (!made) return
    const colors = themeColors()
    made.renderer.setClearColor(colors.background)
    if (bedGroup.current) {
      made.scene.remove(bedGroup.current)
      disposeTree(bedGroup.current)
    }
    bedGroup.current = makeBed(bed, colors)
    made.scene.add(bedGroup.current)
    for (const [role, segments] of lines.current) {
      ;(segments.material as LineBasicMaterial).color.copy(colors.roles[role])
    }
    made.render()
  }, [theme, bed, preview])

  useEffect(() => {
    for (const [role, segments] of lines.current) {
      const end = preview.roles[role].layerStart[top + 1] ?? 0
      segments.visible = !hidden.has(role)
      // Two vertices per segment.
      segments.geometry.setDrawRange(0, end * 2)
    }
    stage.current?.render()
  }, [top, hidden, preview])

  return (
    <div ref={host} className="absolute inset-0">
      {failed ? (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-dim max-w-sm text-center text-[13px] leading-[1.6]">
            This browser can't draw the 3D view. The plate is sliced; its time and material are
            above.
          </p>
        </div>
      ) : (
        <canvas
          ref={canvas}
          aria-label={`Sliced plate, layer ${String(top + 1)} of ${String(preview.layers.length)}`}
          className="block h-full w-full touch-none"
        />
      )}
    </div>
  )
}

function Legend({
  preview,
  hidden,
  onToggle,
}: {
  preview: Preview
  hidden: ReadonlySet<Role>
  onToggle: (role: Role) => void
}) {
  // Read for its re-render: the swatches follow the theme.
  useTheme()
  const colors = themeColors()
  return (
    <ul
      aria-label="Path types"
      className="border-rule bg-base-100/90 absolute top-3 right-3 border p-1.5 backdrop-blur-sm wide:top-auto wide:right-auto wide:bottom-3 wide:left-3"
    >
      {ROLES.filter((role) => preview.roles[role].positions.length > 0).map((role) => {
        const shown = !hidden.has(role)
        return (
          <li key={role}>
            <button
              type="button"
              aria-pressed={shown}
              onClick={() => {
                onToggle(role)
              }}
              className={`flex min-h-9 w-full cursor-pointer items-center gap-2 px-2 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-7 ${
                shown ? 'text-base-content' : 'text-faint line-through'
              }`}
            >
              <span
                aria-hidden="true"
                className="border-rule inline-block size-2.5 shrink-0 border"
                style={{ backgroundColor: shown ? `#${colors.roles[role].getHexString()}` : 'transparent' }}
              />
              {ROLE_LABEL[role]}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Upright beside the view at `wide`, the way Orca has it; across the bottom on a phone. */
function LayerSlider({
  preview,
  top,
  onChange,
}: {
  preview: Preview
  top: number
  onChange: (layer: number) => void
}) {
  const layer = preview.layers[top]
  return (
    <div className="border-rule bg-base-100 absolute inset-x-0 bottom-0 flex items-center gap-3 border-t px-3 py-2 wide:static wide:w-20 wide:flex-col wide:border-t-0 wide:border-l wide:py-4">
      <span className="text-faint font-mono text-[10px] tracking-[0.12em] wide:order-first">
        {String(top + 1)}/{String(preview.layers.length)}
      </span>
      <input
        type="range"
        min={0}
        max={preview.layers.length - 1}
        value={top}
        onChange={(event) => {
          onChange(Number(event.target.value))
        }}
        aria-label="Top layer shown"
        aria-valuetext={`Layer ${String(top + 1)} of ${String(preview.layers.length)}, ${layer ? layer.z.toFixed(2) : '0'} mm`}
        className="accent-primary h-6 min-w-0 flex-1 cursor-pointer wide:h-auto wide:w-6 wide:[direction:rtl] wide:[writing-mode:vertical-lr]"
      />
      <span className="text-dim font-mono text-[10px] tracking-[0.08em]">
        {layer ? `${layer.z.toFixed(2)} mm` : ''}
      </span>
    </div>
  )
}
