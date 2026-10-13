import screenUrl from '../../assets/slicer-screen.png'

/**
 * Where each number sits on the screenshot, in percent of its width and height. The top bar's
 * numbers have no `y`: they sit above the frame, where they cover nothing. Retake the screenshot
 * and these move with it.
 */
const TAGS: { n: number; x: number; y?: number }[] = [
  { n: 1, x: 2.2 },
  { n: 2, x: 17.6 },
  { n: 3, x: 78.1 },
  { n: 4, x: 25.8, y: 12.6 },
  { n: 5, x: 34.6, y: 40.3 },
  { n: 6, x: 32.4, y: 14.8 },
  { n: 7, x: 85.7, y: 13.4 },
]

/** The workspace as a member sees it, numbered to match the list beside it. */
export function WorkspaceMap() {
  return (
    <figure className="@container my-6">
      {/* On a phone the screenshot keeps a readable size and scrolls sideways, as the drawings do. */}
      <p aria-hidden="true" className="text-faint mb-1 font-mono text-[10px] tracking-[0.12em] @min-[36rem]:hidden">
        SCROLL SIDEWAYS →
      </p>
      <div className="overflow-x-auto pt-6">
        <div className="relative min-w-[36rem]">
          <img
            src={screenUrl}
            width={1094}
            height={596}
            alt="The slicer screen: a bar across the top with PREPARE and PREVIEW, the status line, and the SLICE PLATE and REQUEST PRINT buttons; settings down the left; the plate in the middle with the toolbar over it; the object list down the right, with the selected object's position, rotation and size under it."
            className="border-rule block h-auto w-full border"
          />
          {TAGS.map(({ n, x, y }) => (
            <span
              key={n}
              aria-hidden="true"
              style={{ left: `${String(x)}%`, top: y === undefined ? undefined : `${String(y)}%` }}
              className={`bg-primary text-primary-content absolute grid size-[18px] -translate-x-1/2 place-items-center font-mono text-[11px] font-bold ${
                y === undefined ? 'bottom-full mb-1.5' : '-translate-y-1/2'
              }`}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
    </figure>
  )
}
