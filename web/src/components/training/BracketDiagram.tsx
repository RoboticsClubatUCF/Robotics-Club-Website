import { useId } from 'react'

type Point = [number, number, number]
type Face = { points: Point[]; normal: Point }
type Orientation = {
  letter: string
  name: string
  contact: string
  description: string
  turn: (p: Point) => Point
  normal: (p: Point) => Point
  size: Point
  layer: number
  footprint: [number, number][]
}

// The practice part: a 40 mm extrusion of a 24 × 30 mm L, with 4 mm walls.
const outline = [[0, 0], [24, 0], [24, 4], [4, 4], [4, 30], [0, 30]] as const
const faces: Face[] = [
  { points: outline.map(([y, z]) => [0, y, z]), normal: [-1, 0, 0] },
  { points: outline.map(([y, z]) => [40, y, z]), normal: [1, 0, 0] },
  ...outline.map(([y, z], i): Face => {
    const [nextY, nextZ] = outline[(i + 1) % outline.length]!
    return {
      points: [[0, y, z], [40, y, z], [40, nextY, nextZ], [0, nextY, nextZ]],
      normal: [0, nextZ - z, y - nextY],
    }
  }),
]

const orientations: Orientation[] = [
  {
    letter: 'A', name: 'On its foot', contact: 'Short side on the plate',
    description: 'The short side rests on the plate and the long side stands upright.',
    turn: (p) => p, normal: (p) => p, size: [40, 24, 30], layer: 15,
    footprint: [[0, 0], [40, 0], [40, 4], [0, 4]],
  },
  {
    letter: 'B', name: 'On its back', contact: 'Long side on the plate',
    description: 'The long side rests on the plate and the short side stands upright.',
    turn: ([x, y, z]) => [x, 30 - z, y], normal: ([x, y, z]) => [x, -z, y],
    size: [40, 30, 24], layer: 12.5,
    footprint: [[0, 26], [40, 26], [40, 30], [0, 30]],
  },
  {
    letter: 'C', name: 'On its L-shaped end', contact: 'L-shaped end on the plate',
    description: 'An L-shaped end rests on the plate, with the other L-shaped end on top.',
    turn: ([x, y, z]) => [30 - z, y, x], normal: ([x, y, z]) => [-z, y, x],
    size: [30, 24, 40], layer: 20,
    footprint: outline.map(([y, z]) => [30 - z, y]),
  },
]

// A fixed view and scale keep the three poses comparable. The open corner faces the viewer.
const project = ([x, y, z]: Point) => [0.55 * x + 0.85 * y, -0.38 * x + 0.3 * y - z]
const depth = ([x, y, z]: Point) => -x + (0.55 / 0.85) * y + (0.38 + 0.3 * 0.55 / 0.85) * z

/** A horizontal layer's intersections with a face, including the concave L-shaped ends. */
function crossings(points: Point[], height: number): Point[] {
  return points.flatMap((a, index) => {
    const b = points[(index + 1) % points.length]!
    if ((a[2] <= height) === (b[2] <= height)) return []
    const t = (height - a[2]) / (b[2] - a[2])
    return [[a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), height] as Point]
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** The same bracket in three print orientations, with a matching layer seen from above. */
export function BracketDiagram() {
  return (
    <figure aria-label="Bracket print orientations" className="my-6">
      <div className="mb-4 flex items-center gap-2 text-[12px] text-dim">
        <span aria-hidden="true" className="h-0.5 w-6 bg-primary" />
        Gold marks one example layer.
      </div>
      <div className="grid-fluid grid gap-x-6 gap-y-7 [--col-min:13rem]">
        {orientations.map((orientation) => <BracketPose key={orientation.letter} orientation={orientation} />)}
      </div>
    </figure>
  )
}

function BracketPose({ orientation: pose }: { orientation: Orientation }) {
  const id = useId()
  const [width, length, height] = pose.size
  const offset = (240 - 3 * (0.55 * width + 0.85 * length)) / 2
  const draw = (p: Point) => {
    const [x, y] = project(p)
    return `${String(offset + x! * 3)},${String(160 + y! * 3)}`
  }
  const visible = faces.map((face) => ({
    points: face.points.map(pose.turn), normal: pose.normal(face.normal),
  })).filter((face) => depth(face.normal) > 0)
    .sort((a, b) => a.points.reduce((sum, p) => sum + depth(p), 0) / a.points.length
      - b.points.reduce((sum, p) => sum + depth(p), 0) / b.points.length)
  const layers = Array.from({ length: Math.ceil(height / 2.5) - 1 }, (_, i) => (i + 1) * 2.5)
  const xs = pose.footprint.map(([x]) => x)
  const ys = pose.footprint.map(([, y]) => y)
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2

  return (
    <div className="min-w-0">
      <h3 id={`${id}-name`} className="flex items-baseline gap-2 text-[13px] font-medium">
        <span className="font-mono text-[14px] text-base-content">{pose.letter}</span>
        {pose.name}
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-dim">{pose.contact}</p>
      <svg role="img" aria-labelledby={`${id}-view`} viewBox="0 0 240 215" className="mx-auto mt-2 h-auto w-full max-w-[15rem]">
        <title id={`${id}-view`}>{pose.letter}: {pose.name}. {pose.description} Horizontal lines show layer boundaries, with spacing enlarged for visibility.</title>
        <polygon points={[[-4, -4, 0], [width + 4, -4, 0], [width + 4, length + 4, 0], [-4, length + 4, 0]].map(p => draw(p as Point)).join(' ')}
          className="fill-base-200 stroke-rule" />
        {visible.map((face, index) => (
          <g key={index}>
            <polygon points={face.points.map(draw).join(' ')}
              className={`${face.normal[2] > 0 ? 'fill-base-300' : 'fill-base-200'} stroke-base-content/70`} strokeWidth={1.2} strokeLinejoin="round" />
            {layers.map((z) => {
              const points = crossings(face.points, z)
              return Array.from({ length: points.length / 2 }, (_, j) => (
                <polyline key={`${String(z)}-${String(j)}`} points={[points[j * 2]!, points[j * 2 + 1]!].map(draw).join(' ')}
                  className={z === pose.layer ? 'stroke-primary' : 'stroke-faint'} fill="none" strokeWidth={z === pose.layer ? 2.4 : 0.8} />
              ))
            })}
          </g>
        ))}
        <text x={120} y={210} textAnchor="middle" className="fill-faint font-mono" fontSize={10} letterSpacing="0.08em">BUILD PLATE</text>
      </svg>
      <div className="border-t border-rule pt-3">
        <p className="font-mono text-[10px] tracking-[0.08em] text-dim">ONE LAYER · FROM ABOVE</p>
        <svg role="img" aria-labelledby={`${id}-layer`} viewBox="0 0 120 70" className="mx-auto mt-1 h-20 w-full max-w-[10rem]">
          <title id={`${id}-layer`}>{pose.letter}: One example layer from above, {pose.letter === 'C' ? 'an L shape' : 'a narrow rectangle'}.</title>
          <polygon points={pose.footprint.map(([x, y]) => `${String(60 + (x - centerX) * 2)},${String(35 - (y - centerY) * 2)}`).join(' ')}
            className="fill-primary/15 stroke-primary" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}
