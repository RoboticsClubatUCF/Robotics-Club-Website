import { type ReactNode, useId } from 'react'
export { BracketDiagram } from './BracketDiagram'

/**
 * The training's drawings. Line work in the theme's ink, the thing being pointed at in gold, and
 * what goes wrong in the error red, so both themes work and nothing is a colour of its own. Each
 * says in words what it shows (`aria-label` and the caption); the picture only helps.
 */

function Figure({
  label,
  caption,
  viewBox,
  width = 'max-w-[36rem]',
  children,
}: {
  label: string
  caption?: ReactNode
  viewBox: string
  /** A narrow drawing would scale its type up past the page's. */
  width?: string
  children: ReactNode
}) {
  return (
    <figure className="@container my-6">
      {/* On a phone a wide drawing keeps a readable size and scrolls sideways, rather than
          shrinking its labels to nothing; the cue shows only while it doesn't fit. */}
      <div className="overflow-x-auto">
        {width === 'max-w-[36rem]' && (
          <p aria-hidden="true" className="text-faint mb-1 font-mono text-[10px] tracking-[0.12em] @min-[28rem]:hidden">
            SCROLL SIDEWAYS →
          </p>
        )}
        <svg
          viewBox={viewBox}
          role="img"
          aria-label={label}
          className={`text-dim h-auto w-full ${width === 'max-w-[36rem]' ? 'min-w-[28rem]' : ''} ${width}`}
        >
          {children}
        </svg>
      </div>
      {caption && <figcaption className="text-faint mt-2 max-w-[36rem] text-[12.5px] leading-[1.55]">{caption}</figcaption>}
    </figure>
  )
}

function Label({ x, y, children, anchor = 'middle', tone = 'faint' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; tone?: 'faint' | 'gold' | 'bad' | 'ink' }) {
  const colour = { faint: 'fill-faint', gold: 'fill-primary', bad: 'fill-error', ink: 'fill-base-content' }[tone]
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={10} letterSpacing="0.08em" className={`${colour} font-mono`}>
      {children}
    </text>
  )
}

function Arrow({ x1, y1, x2, y2, tone = 'ink' }: { x1: number; y1: number; x2: number; y2: number; tone?: 'ink' | 'gold' | 'bad' }) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = (turn: number) => `${x2 - 7 * Math.cos(angle + turn)},${y2 - 7 * Math.sin(angle + turn)}`
  const colour = { ink: 'stroke-base-content fill-base-content', gold: 'stroke-primary fill-primary', bad: 'stroke-error fill-error' }[tone]
  return (
    <g className={colour}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1.5} />
      <polygon points={`${x2},${y2} ${head(0.45)} ${head(-0.45)}`} strokeWidth={0} />
    </g>
  )
}

const ink = 'stroke-current fill-none'
const gold = 'stroke-primary fill-none'

/** A model, the same model as layers, and one layer's path from above. */
export function LayersDiagram() {
  const half = (y: number) => (y >= 95 ? 50 : 50 * Math.sqrt(Math.max(0, 1 - ((95 - y) / 50) ** 2)))
  const layers = Array.from({ length: 10 }, (_, i) => {
    const bottom = 140 - 9.5 * i
    const top = bottom - 8
    return { top, half: half(top + 2) }
  })
  const lines: [number, number, number, number][] = []
  for (let k = -36; k <= 36; k += 9) {
    const t = Math.sqrt(38 ** 2 - k ** 2)
    const [nx, ny, dx, dy] = [Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2]
    lines.push([400 + k * nx - t * dx, 92 + k * ny - t * dy, 400 + k * nx + t * dx, 92 + k * ny + t * dy])
  }
  return (
    <Figure
      viewBox="0 0 480 180"
      label="A model, the same model cut into flat layers, and one layer seen from above with its outline and the lines that fill it."
      caption="The slicer cuts your model into thin flat layers and works out the nozzle's path for each: the outline first, then the inside."
    >
      <path d="M30,140 L30,95 A50,50 0 0 1 130,95 L130,140 Z" className="stroke-current fill-current" fillOpacity={0.08} strokeWidth={1.5} />
      <Arrow x1={145} y1={95} x2={175} y2={95} />
      {layers.map((layer, i) => (
        <rect
          key={layer.top}
          x={240 - layer.half}
          y={layer.top}
          width={layer.half * 2}
          height={8}
          className={i === layers.length - 1 ? 'fill-primary' : 'fill-current'}
          fillOpacity={i === layers.length - 1 ? 1 : 0.35}
        />
      ))}
      <polygon points="232,24 248,24 240,36" className="fill-base-content" />
      <rect x={234} y={10} width={12} height={14} className="fill-base-content" />
      <Arrow x1={305} y1={95} x2={335} y2={95} />
      {lines.map(([x1, y1, x2, y2]) => (
        <line key={`${String(x1)}-${String(y1)}`} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-current" strokeWidth={1.5} />
      ))}
      <circle cx={400} cy={92} r={46} className={gold} strokeWidth={2.5} />
      <circle cx={400} cy={92} r={42} className={gold} strokeWidth={2.5} />
      <Label x={80} y={168}>YOUR MODEL</Label>
      <Label x={240} y={168}>CUT INTO LAYERS</Label>
      <Label x={400} y={168}>ONE LAYER, FROM ABOVE</Label>
    </Figure>
  )
}

/** The plate from above: which way X and Y run, and where 0, 0 is. */
export function PlateAxes() {
  const grid = Array.from({ length: 9 }, (_, i) => 50 + (i + 1) * 20)
  return (
    <Figure
      width="max-w-[22rem]"
      viewBox="0 0 300 275"
      label="The plate from above. X runs left to right along the front, Y runs from the front to the back, and 0, 0 is the front left corner. The plate is 256 by 256 millimetres. The hatched corner at the front right is kept clear."
      caption="Seen from above, with the printer's door at the bottom. A part's X and Y are where its middle is."
    >
      <rect x={50} y={20} width={200} height={200} className="stroke-current fill-current" fillOpacity={0.05} strokeOpacity={0.7} />
      {grid.map((v) => (
        <g key={v} className="stroke-current" strokeOpacity={0.15}>
          <line x1={v} y1={20} x2={v} y2={220} />
          <line x1={50} y1={v - 30} x2={250} y2={v - 30} />
        </g>
      ))}
      <rect x={242.2} y={204.4} width={7.8} height={15.6} className="fill-warning" fillOpacity={0.6} />
      <rect x={110} y={120} width={20} height={20} className="fill-primary" fillOpacity={0.3} />
      <rect x={110} y={120} width={20} height={20} className={gold} strokeWidth={1.5} />
      <rect x={118} y={128} width={4} height={4} className="fill-primary" />
      <Label x={135} y={116} anchor="start" tone="gold">X 90, Y 115</Label>
      <Arrow x1={50} y1={238} x2={262} y2={238} />
      <Arrow x1={32} y1={220} x2={32} y2={12} />
      <Label x={268} y={241} anchor="start" tone="ink">X</Label>
      <Label x={32} y={8} tone="ink">Y</Label>
      <Label x={40} y={252} anchor="end">0, 0</Label>
      <Label x={250} y={252}>256</Label>
      <Label x={20} y={24} anchor="middle">256</Label>
      <Label x={150} y={268}>FRONT</Label>
    </Figure>
  )
}

/** Walls leaning out at three angles: two print, one droops. */
export function OverhangDiagram() {
  const stack = (x0: number, degrees: number, layers: number, droops: boolean) => {
    const off = 10 * Math.tan((degrees * Math.PI) / 180)
    return Array.from({ length: layers }, (_, i) => {
      const x = x0 + i * off
      const y = 140 - (i + 1) * 10
      const bad = droops && i > 1
      const sag = bad ? (i - 1) * 4 : 0
      return (
        <polygon
          key={i}
          points={`${x},${y} ${x + 50},${y + sag} ${x + 50},${y + 9 + sag} ${x},${y + 9}`}
          className={bad ? 'fill-error' : 'fill-current'}
          fillOpacity={bad ? 0.7 : 0.45}
        />
      )
    })
  }
  return (
    <Figure
      viewBox="0 0 520 175"
      label="Three walls built from stacked layers, each leaning out further: 20 degrees and 45 degrees from upright print fine, 70 degrees droops because each layer hangs too far past the one below."
      caption="Angles measured from straight up. Each layer has to rest on the one below; past about 45° too much of it hangs in the air."
    >
      <line x1={10} y1={140.5} x2={510} y2={140.5} className="stroke-current" strokeOpacity={0.6} />
      {stack(30, 20, 9, false)}
      {stack(170, 45, 9, false)}
      {stack(330, 70, 6, true)}
      <line x1={80} y1={140} x2={80} y2={40} className="stroke-primary" strokeDasharray="3 3" />
      <line x1={220} y1={140} x2={220} y2={40} className="stroke-primary" strokeDasharray="3 3" />
      <line x1={380} y1={140} x2={380} y2={60} className="stroke-primary" strokeDasharray="3 3" />
      <Label x={70} y={158} tone="ink">20°</Label>
      <Label x={70} y={170}>PRINTS</Label>
      <Label x={235} y={158} tone="ink">45°</Label>
      <Label x={235} y={170}>STILL PRINTS</Label>
      <Label x={420} y={158} tone="bad">70°</Label>
      <Label x={420} y={170} tone="bad">DROOPS · NEEDS SUPPORT</Label>
    </Figure>
  )
}

/** Two overhanging arms against a 30° threshold: the flatter one gets supports. */
export function ThresholdDiagram() {
  const supports = Array.from({ length: 7 }, (_, i) => 116 + i * 13)
  const slope = (x: number) => 150 - (x - 80) * Math.tan((20 * Math.PI) / 180)
  return (
    <Figure
      viewBox="0 0 480 185"
      label="Two parts with an underside sloping up and out. The left one slopes 20 degrees from flat and gets supports under it. The right one slopes 60 degrees from flat and needs none."
      caption="The threshold angle is measured from flat. With it at 30°, an underside flatter than 30° gets supports and a steeper one doesn't."
    >
      <line x1={10} y1={150.5} x2={470} y2={150.5} className="stroke-current" strokeOpacity={0.6} />
      {supports.map((x) => (
        <line key={x} x1={x} y1={slope(x) + 2} x2={x} y2={150} className="stroke-success" strokeWidth={2} />
      ))}
      <polygon points={`40,150 80,150 200,${slope(200)} 200,40 40,40`} className="stroke-current fill-current" fillOpacity={0.3} />
      <polygon points="280,150 320,150 380,46 380,40 280,40" className="stroke-current fill-current" fillOpacity={0.3} />
      <path d={`M110,150 A30,30 0 0 0 ${80 + 30 * Math.cos(0.349)},${150 - 30 * Math.sin(0.349)}`} className={gold} strokeWidth={1.5} />
      <path d={`M350,150 A30,30 0 0 0 ${320 + 30 * Math.cos(1.047)},${150 - 30 * Math.sin(1.047)}`} className={gold} strokeWidth={1.5} />
      <Label x={120} y={168}>20° FROM FLAT</Label>
      <Label x={120} y={180} tone="ink">GETS SUPPORT</Label>
      <Label x={330} y={168}>60° FROM FLAT</Label>
      <Label x={330} y={180} tone="ink">NO SUPPORT</Label>
    </Figure>
  )
}

/** The same beam printed two ways and pushed at the end. */
export function StrengthDiagram() {
  const id = useId()
  return (
    <Figure
      viewBox="0 0 480 170"
      label="Two beams fixed to a wall and pushed down at the free end. The left one has its layers running along its length and holds. The right one has its layers stacked across its length and snaps between two layers next to the wall."
      caption="The same beam held at a wall and pushed down at the end. Left: printed lying down, the layers run along it. Right: printed standing up, the layers cross it."
    >
      <defs>
        <clipPath id={`${id}-a`}>
          <rect x={30} y={70} width={170} height={30} />
        </clipPath>
        <clipPath id={`${id}-b`}>
          <rect x={270} y={70} width={170} height={30} />
        </clipPath>
      </defs>
      <rect x={18} y={30} width={12} height={110} className="fill-current" fillOpacity={0.4} />
      <rect x={258} y={30} width={12} height={110} className="fill-current" fillOpacity={0.4} />
      <rect x={30} y={70} width={170} height={30} className="stroke-current fill-current" fillOpacity={0.15} />
      <g clipPath={`url(#${id}-a)`}>
        {Array.from({ length: 5 }, (_, i) => (
          <line key={i} x1={30} x2={200} y1={76 + i * 6} y2={76 + i * 6} className="stroke-current" strokeOpacity={0.6} />
        ))}
      </g>
      <rect x={270} y={70} width={170} height={30} className="stroke-current fill-current" fillOpacity={0.15} />
      <g clipPath={`url(#${id}-b)`}>
        {Array.from({ length: 21 }, (_, i) => (
          <line key={i} y1={70} y2={100} x1={278 + i * 8} x2={278 + i * 8} className="stroke-current" strokeOpacity={0.6} />
        ))}
      </g>
      <polyline points="276,68 280,76 274,84 281,92 276,102" className="stroke-error fill-none" strokeWidth={2.5} />
      <Arrow x1={190} y1={30} x2={190} y2={66} tone="gold" />
      <Arrow x1={430} y1={30} x2={430} y2={66} tone="gold" />
      <Label x={115} y={124} tone="ink">LAYERS ALONG IT</Label>
      <Label x={115} y={136}>HOLDS</Label>
      <Label x={355} y={124} tone="bad">LAYERS ACROSS IT</Label>
      <Label x={355} y={136} tone="bad">SNAPS BETWEEN LAYERS</Label>
    </Figure>
  )
}

/** The mushroom both ways up. */
export function MushroomDiagram() {
  return (
    <Figure
      viewBox="0 0 480 175"
      label="Two orientations of the same mushroom. A, on the left: standing on its stem, cap on top. B, on the right: upside down, cap on the plate."
    >
      <line x1={10} y1={150.5} x2={470} y2={150.5} className="stroke-current" strokeOpacity={0.6} />
      <rect x={96} y={94} width={48} height={56} className="stroke-current fill-current" fillOpacity={0.3} />
      <rect x={60} y={74} width={120} height={20} className="stroke-current fill-current" fillOpacity={0.3} />
      <rect x={300} y={130} width={120} height={20} className="stroke-current fill-current" fillOpacity={0.3} />
      <rect x={336} y={74} width={48} height={56} className="stroke-current fill-current" fillOpacity={0.3} />
      <Label x={120} y={168} tone="ink">A · CAP ON TOP</Label>
      <Label x={360} y={168} tone="ink">B · CAP ON PLATE</Label>
    </Figure>
  )
}

/** A brim and a skirt around a part, from above. */
export function BrimSkirtDiagram() {
  return (
    <Figure
      viewBox="0 0 480 205"
      label="A square part from above. Rings of brim are joined to its edge. A skirt is a separate loop further out that doesn't touch it."
      caption="From above. A brim is joined to the part's first layer and peels off afterwards. A skirt is drawn first, apart from the part."
    >
      {[4, 8, 12, 16].map((r) => (
        <rect key={r} x={200 - r} y={62 - r} width={80 + 2 * r} height={80 + 2 * r} rx={r} className={ink} strokeOpacity={0.7} />
      ))}
      <rect x={166} y={28} width={148} height={148} rx={34} className={ink} strokeDasharray="5 4" strokeOpacity={0.7} />
      <rect x={200} y={62} width={80} height={80} className="stroke-primary fill-primary" fillOpacity={0.25} strokeWidth={1.5} />
      <Label x={240} y={106} tone="gold">PART</Label>
      <line x1={296} y1={102} x2={350} y2={102} className="stroke-current" />
      <Label x={354} y={105} anchor="start" tone="ink">BRIM</Label>
      <Label x={354} y={117} anchor="start">TOUCHES THE PART</Label>
      <line x1={314} y1={160} x2={350} y2={170} className="stroke-current" />
      <Label x={354} y={173} anchor="start" tone="ink">SKIRT</Label>
      <Label x={354} y={185} anchor="start">APART FROM IT</Label>
    </Figure>
  )
}

/** A curved side in thick and thin layers. */
export function LayerHeightDiagram() {
  const steps = (x0: number, height: number) => {
    const out: ReactNode[] = []
    for (let bottom = 150; bottom > 40; bottom -= height) {
      const top = Math.max(40, bottom - height)
      const reach = Math.sqrt(Math.max(0, 110 ** 2 - (150 - top) ** 2))
      out.push(<rect key={bottom} x={x0} y={top} width={reach} height={bottom - top - 0.8} className="fill-current" fillOpacity={0.4} />)
    }
    return out
  }
  const curve = (x0: number) => `M${x0},40 A110,110 0 0 1 ${x0 + 110},150`
  return (
    <Figure
      viewBox="0 0 480 185"
      label="The same curved edge printed in thick layers, where the steps between layers show, and in thin layers, which follow the curve closely."
    >
      <line x1={10} y1={150.5} x2={470} y2={150.5} className="stroke-current" strokeOpacity={0.6} />
      {steps(40, 16)}
      <path d={curve(40)} className={gold} strokeDasharray="3 3" strokeWidth={1.5} />
      {steps(280, 6)}
      <path d={curve(280)} className={gold} strokeDasharray="3 3" strokeWidth={1.5} />
      <Label x={95} y={168} tone="ink">THICK LAYERS</Label>
      <Label x={95} y={180}>FASTER · STEPS SHOW</Label>
      <Label x={335} y={168} tone="ink">THIN LAYERS</Label>
      <Label x={335} y={180}>SMOOTHER · SLOWER</Label>
    </Figure>
  )
}

/** Where each layer's loop starts and stops: lined up, or scattered. */
export function SeamDiagram() {
  const rows = Array.from({ length: 14 }, (_, i) => 40 + i * 8)
  const scatter = [12, 70, 30, 88, 50, 18, 76, 40, 62, 8, 84, 26, 56, 36]
  return (
    <Figure
      viewBox="0 0 480 175"
      label="Two cylinders seen from the side. On the left every layer's seam is in the same place, making one line up the side. On the right the seams are scattered."
    >
      {[60, 300].map((x) => (
        <g key={x}>
          <rect x={x} y={36} width={120} height={114} className="stroke-current fill-current" fillOpacity={0.12} />
          {rows.map((y) => (
            <line key={y} x1={x} x2={x + 120} y1={y} y2={y} className="stroke-current" strokeOpacity={0.35} />
          ))}
        </g>
      ))}
      {rows.map((y) => (
        <rect key={y} x={128} y={y + 1.5} width={5} height={5} className="fill-primary" />
      ))}
      {rows.map((y, i) => (
        <rect key={y} x={312 + scatter[i]!} y={y + 1.5} width={5} height={5} className="fill-primary" />
      ))}
      <Label x={120} y={166} tone="ink">ALIGNED OR BACK · ONE LINE</Label>
      <Label x={360} y={166} tone="ink">RANDOM · SCATTERED</Label>
    </Figure>
  )
}

/** A print cut open: walls, top and bottom layers, infill. */
export function CrossSectionDiagram() {
  const id = useId()
  return (
    <Figure
      viewBox="0 0 480 190"
      label="A printed block cut open. Its outline is a few walls, the top and bottom are solid layers, and the inside is a sparse crossing pattern called infill."
      caption="A print cut open. It isn't solid: it's a skin of walls and solid top and bottom layers, with a pattern inside."
    >
      <defs>
        <clipPath id={`${id}-in`}>
          <rect x={132} y={52} width={196} height={86} />
        </clipPath>
      </defs>
      {[0, 4, 8].map((inset) => (
        <rect key={inset} x={120 + inset} y={30 + inset} width={220 - 2 * inset} height={130 - 2 * inset} className={gold} strokeWidth={2} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={`t${String(i)}`} x1={132} x2={328} y1={42 + i * 2} y2={42 + i * 2} className="stroke-current" strokeOpacity={0.7} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={`b${String(i)}`} x1={132} x2={328} y1={138 + i * 2} y2={138 + i * 2} className="stroke-current" strokeOpacity={0.7} />
      ))}
      <g clipPath={`url(#${id}-in)`}>
        {Array.from({ length: 14 }, (_, i) => (
          <g key={i} className="stroke-info" strokeOpacity={0.8}>
            <line x1={100 + i * 22} y1={140} x2={190 + i * 22} y2={50} />
            <line x1={100 + i * 22} y1={50} x2={190 + i * 22} y2={140} />
          </g>
        ))}
      </g>
      <line x1={342} y1={34} x2={372} y2={34} className="stroke-current" />
      <Label x={376} y={37} anchor="start" tone="gold">WALLS</Label>
      <line x1={330} y1={46} x2={372} y2={58} className="stroke-current" />
      <Label x={376} y={61} anchor="start" tone="ink">TOP LAYERS</Label>
      <line x1={322} y1={95} x2={372} y2={95} className="stroke-current" />
      <Label x={376} y={98} anchor="start" tone="ink">INFILL</Label>
      <line x1={330} y1={144} x2={372} y2={134} className="stroke-current" />
      <Label x={376} y={137} anchor="start" tone="ink">BOTTOM LAYERS</Label>
    </Figure>
  )
}

/** Six infill patterns, a tile each. */
export function InfillTiles() {
  const id = useId()
  const tiles: { name: string; draw: (x: number) => ReactNode }[] = [
    {
      name: 'LINE',
      draw: (x) => Array.from({ length: 8 }, (_, i) => <line key={i} x1={x - 30 + i * 12} y1={70} x2={x + i * 12} y2={10} />),
    },
    {
      name: 'GRID',
      draw: (x) =>
        Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <line x1={x - 30 + i * 12} y1={70} x2={x + i * 12} y2={10} />
            <line x1={x - 30 + i * 12} y1={10} x2={x + i * 12} y2={70} />
          </g>
        )),
    },
    {
      name: 'TRIANGLES',
      draw: (x) =>
        Array.from({ length: 6 }, (_, i) => (
          <g key={i}>
            <line x1={x} x2={x + 60} y1={10 + i * 12} y2={10 + i * 12} />
            <line x1={x - 20 + i * 14} y1={70} x2={x + 15 + i * 14} y2={10} />
            <line x1={x - 20 + i * 14} y1={10} x2={x + 15 + i * 14} y2={70} />
          </g>
        )),
    },
    {
      name: 'HONEYCOMB',
      draw: (x) =>
        [0, 1, 2].flatMap((row) =>
          [0, 1, 2, 3].map((col) => {
            const cx = x + 6 + col * 17 + (row % 2) * 8.5
            const cy = 16 + row * 15
            const points = Array.from({ length: 6 }, (_, k) => {
              const a = (Math.PI / 3) * k + Math.PI / 6
              return `${cx + 9 * Math.cos(a)},${cy + 9 * Math.sin(a)}`
            }).join(' ')
            return <polygon key={`${String(row)}-${String(col)}`} points={points} fill="none" />
          }),
        ),
    },
    {
      name: 'GYROID',
      draw: (x) =>
        Array.from({ length: 5 }, (_, i) => {
          const y = 14 + i * 12
          const d = Array.from({ length: 31 }, (_, k) => `${k === 0 ? 'M' : 'L'}${x + k * 2},${y + 4 * Math.sin(k / 3 + i)}`).join(' ')
          return <path key={i} d={d} fill="none" />
        }),
    },
    {
      name: 'CONCENTRIC',
      draw: (x) => [0, 7, 14, 21].map((inset) => <rect key={inset} x={x + inset} y={10 + inset} width={60 - 2 * inset} height={60 - 2 * inset} fill="none" />),
    },
  ]
  return (
    <Figure
      viewBox="0 0 480 95"
      label="Six infill patterns from above: straight lines, a crossing grid, triangles, hexagons, a wavy gyroid, and rings following the outline."
    >
      {tiles.map((tile, i) => {
        const x = 12 + i * 78
        return (
          <g key={tile.name}>
            <defs>
              <clipPath id={`${id}-${String(i)}`}>
                <rect x={x} y={10} width={60} height={60} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${id}-${String(i)})`} className="stroke-info" strokeWidth={1.4}>
              {tile.draw(x)}
            </g>
            <rect x={x} y={10} width={60} height={60} className={ink} strokeOpacity={0.6} />
            <Label x={x + 30} y={86}>{tile.name}</Label>
          </g>
        )
      })}
    </Figure>
  )
}
