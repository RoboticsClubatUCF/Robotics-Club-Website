import { type ReactNode, useId } from 'react'

type Pattern = { name: string; description: string; draw: (earlier: boolean) => ReactNode }

const lines = (reverse: boolean) => Array.from({ length: 12 }, (_, i) => (
  <line key={i} x1={-60 + i * 12} x2={i * 12} y1={reverse ? 0 : 60} y2={reverse ? 60 : 0} />
))

// Sample the gyroid's zero contour at two heights, rather than drawing unrelated sine waves.
function gyroidPath(z: number): string {
  const field = (x: number, y: number) => {
    const a = x * Math.PI / 12
    const b = y * Math.PI / 12
    return Math.sin(a) * Math.cos(b) + Math.sin(b) * Math.cos(z) + Math.sin(z) * Math.cos(a)
  }
  const segments: string[] = []
  for (let y = 0; y < 60; y += 2) for (let x = 0; x < 60; x += 2) {
    const corners: [number, number][] = [[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2]]
    const values = corners.map(([cx, cy]) => field(cx, cy))
    const points: [number, number][] = []
    corners.forEach((a, i) => {
      const next = (i + 1) % 4
      if ((values[i]! >= 0) === (values[next]! >= 0)) return
      const b = corners[next]!
      const t = values[i]! / (values[i]! - values[next]!)
      points.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    })
    if (points.length === 4 && (field(x + 1, y + 1) >= 0) !== (values[0]! >= 0)) points.push(points.shift()!)
    for (let i = 0; i < points.length; i += 2) {
      const a = points[i]!
      const b = points[i + 1]!
      segments.push(`M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}`)
    }
  }
  return segments.join(' ')
}

const gyroid = { earlier: gyroidPath(0.25), current: gyroidPath(1.05) }
const patterns: Pattern[] = [
  { name: 'LINE', description: 'Parallel straight lines change direction between layers.', draw: lines },
  { name: 'GRID', description: 'Two directions of lines cross on each layer.', draw: () => <>{lines(false)}{lines(true)}</> },
  {
    name: 'TRIANGLES', description: 'Three directions of lines form triangles on each layer.',
    draw: () => Array.from({ length: 10 }, (_, i) => {
      const x = (i - 3) * 24 / Math.sqrt(3)
      return <g key={i}>
        <line x1={0} x2={60} y1={i * 12} y2={i * 12} />
        <line x1={x} x2={x + 60 / Math.sqrt(3)} y1={0} y2={60} />
        <line x1={x} x2={x + 60 / Math.sqrt(3)} y1={60} y2={0} />
      </g>
    }),
  },
  {
    name: 'HONEYCOMB', description: 'Hexagons repeat on each layer.',
    draw: () => Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => {
      const cx = 7 + (col + (row % 2) / 2) * 8 * Math.sqrt(3)
      const cy = 4 + row * 12
      const points = Array.from({ length: 6 }, (_, k) => {
        const angle = k * Math.PI / 3 + Math.PI / 6
        return `${String(cx + 8 * Math.cos(angle))},${String(cy + 8 * Math.sin(angle))}`
      }).join(' ')
      return <polygon key={`${String(row)}-${String(col)}`} points={points} />
    })),
  },
  { name: 'GYROID', description: 'Curved paths change shape as the layers rise.', draw: (earlier) => <path d={earlier ? gyroid.earlier : gyroid.current} /> },
  {
    name: 'CONCENTRIC', description: 'Nested rings follow the outline on each layer.',
    draw: () => [3, 11, 19, 27].map((inset) => <rect key={inset} x={inset} y={inset} width={60 - 2 * inset} height={60 - 2 * inset} />),
  },
]

/** Separate the layer planes slightly so repeated paths remain visible underneath. */
export function InfillTiles() {
  return (
    <figure aria-label="Infill patterns by layer" className="my-6">
      <div className="text-dim mb-3 flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
        <span className="flex items-center gap-2"><span aria-hidden="true" className="h-0.5 w-5 bg-info" />Current layer</span>
        <span className="flex items-center gap-2"><span aria-hidden="true" className="h-0.5 w-5 bg-faint" />Previous layers</span>
      </div>
      <div className="grid-fluid grid gap-x-3 gap-y-5 [--col-min:6rem]">
        {patterns.map((pattern) => <InfillTile key={pattern.name} pattern={pattern} />)}
      </div>
    </figure>
  )
}

function InfillTile({ pattern }: { pattern: Pattern }) {
  const id = useId()
  return (
    <div className="min-w-0">
      <svg role="img" aria-labelledby={`${id}-name`} viewBox="0 0 80 80" className="mx-auto h-auto w-full max-w-[7rem]" fill="none" strokeWidth={1.15} strokeLinejoin="round">
        <title id={`${id}-name`}>{pattern.name}: {pattern.description} Current layer in blue; previous layers in gray. Layer planes are separated for clarity.</title>
        <defs><clipPath id={`${id}-clip`}><rect width={60} height={60} /></clipPath></defs>
        <g transform="translate(6 11)" className="stroke-faint">
          <g clipPath={`url(#${id}-clip)`}>{pattern.draw(true)}</g>
          <rect width={60} height={60} />
        </g>
        {[[0, 0], [60, 0], [60, 60], [0, 60]].map(([x, y]) => (
          <line key={`${String(x)}-${String(y)}`} x1={x! + 6} y1={y! + 11} x2={x! + 10} y2={y! + 5} className="stroke-faint" />
        ))}
        <g transform="translate(10 5)">
          <g clipPath={`url(#${id}-clip)`} className="stroke-info">{pattern.draw(false)}</g>
          <rect width={60} height={60} className="stroke-dim" />
        </g>
      </svg>
      <p className="text-dim text-center font-mono text-[10px] tracking-[0.08em]">{pattern.name}</p>
    </div>
  )
}
