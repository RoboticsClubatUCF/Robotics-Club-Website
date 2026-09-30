import { useState } from 'react'
import type { ApiMilestone } from '../../lib/api/api'
import { frameStyle } from '../../lib/media/imageFraming'
import { imageSrc } from '../../lib/media/storedFiles'

/**
 * The about page's timeline, with a photograph on any line that has one.
 *
 * Rules and columns rather than cards, the way the project list is drawn: what somebody does with a
 * timeline is read down the year column, and cards make that a scavenger hunt. Photos take a third
 * column at width, so the years and sentences stay one straight read and the pictures run down the
 * right beside the moments they belong to. On a phone a photo takes the row's full width under its
 * sentence; in the sentence's column it was about 220px wide.
 *
 * Without a single photo the timeline keeps the story's reading measure; the extra column would be
 * an empty strip.
 */
export function Timeline({ milestones }: { milestones: ApiMilestone[] }) {
  // Truthiness rather than `!== null`: during a deploy the API before this one
  // sends lines with no photo fields at all.
  const photos = milestones.some((line) => line.imageUrl)

  return (
    <div className={`mt-9 ${photos ? 'max-w-[66rem]' : 'max-w-[42rem]'}`}>
      {milestones.map((line) => (
        <div
          key={line.id}
          className={`border-rule grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-4 border-t py-4 wide:gap-x-6 ${
            photos
              ? 'wide:grid-cols-[7rem_minmax(0,1fr)_20rem] wide:py-6'
              : 'wide:grid-cols-[7rem_minmax(0,1fr)]'
          }`}
        >
          <div className="text-primary pt-0.5 font-mono text-[11px] font-medium tracking-[0.06em]">
            {line.when}
          </div>
          <p className="text-dim text-sm leading-[1.6] text-pretty">{line.what}</p>
          {line.imageUrl && (
            <Photo url={line.imageUrl} caption={line.imageCaption} framing={line} />
          )}
        </div>
      ))}
      <div className="border-rule border-t" />
    </div>
  )
}

function Photo({
  url,
  caption,
  framing,
}: {
  url: string
  caption: string | null
  framing: ApiMilestone
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="col-span-full wide:col-[3] wide:row-start-1">
      {/* The hatch well holds the frame's shape while the picture loads, and
          stays as the picture if it never does. */}
      <div className="bg-hatch border-rule relative aspect-[16/10] overflow-hidden border">
        <img
          src={imageSrc(url)}
          alt={caption ?? ''}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            setLoaded(true)
          }}
          style={frameStyle(framing)}
          className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
      {/* Already the picture's `alt`, so hidden from screen readers rather than
          read twice. */}
      {caption && (
        <p
          aria-hidden="true"
          className="text-faint mt-2 text-[12px] leading-[1.4] text-pretty"
        >
          {caption}
        </p>
      )}
    </div>
  )
}
