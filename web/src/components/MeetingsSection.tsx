import { meeting, meetingSpecs } from '../content/home'

export function MeetingsSection() {
  return (
    <section
      id="join"
      className="border-rule grid scroll-mt-20 border-t wide:grid-cols-[1.15fr_1fr]"
    >
      <div className="px-page py-16">
        <h2 className="mb-4.5 text-[2rem] leading-[1.1] font-bold tracking-[-0.02em] wide:text-[2.5rem]">
          Meetings are open.
          <br />
          Just show up.
        </h2>
        <p className="text-dim mb-7.5 max-w-[26.25rem] text-base leading-[1.65]">
          {meeting.blurb}
        </p>

        <dl className="max-w-[27.5rem]">
          {meetingSpecs.map((spec) => (
            <div
              key={spec.term}
              className="flex justify-between border-t border-white/12 py-3.5 last:border-b"
            >
              <dt className="text-faint font-mono text-xs font-medium tracking-[0.1em]">
                {spec.term}
              </dt>
              <dd className={`text-sm font-medium ${spec.accent ? 'text-primary' : ''}`}>
                {spec.detail}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Placeholder for the build-night photo. The diagonal hatch is the two
          off-black surface tones, so it reads as "nothing here yet" rather than
          as a broken image. Swap the whole div for an <img> with
          `h-full w-full object-cover` once there is a shot worth using. */}
      <div className="border-rule flex min-h-55 items-end border-t bg-[repeating-linear-gradient(135deg,var(--color-base-300)_0_12px,var(--color-base-200)_12px_24px)] p-5.5 wide:min-h-85 wide:border-t-0 wide:border-l">
        <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]">
          [ PHOTO — WORKSHOP / BUILD NIGHT, 4:3 ]
        </span>
      </div>
    </section>
  )
}
