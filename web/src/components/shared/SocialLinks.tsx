import { socialLinks } from '../../content/home'
import { socialMarks } from './socialMarks'

export function SocialLinks({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex items-center gap-x-1 ${className}`}>
      {socialLinks.map((link) => {
        const mark = socialMarks[link.label]
        const name = mark?.name ?? link.label
        const spacing = mark
          ? 'size-11 justify-center wide:size-9'
          : '-my-2 min-h-9 px-1 py-2 font-mono text-[10px] font-medium tracking-[0.14em]'

        return (
          <li key={link.label}>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={name}
              title={name}
              className={`text-faint hover:text-primary focus-visible:outline-primary flex items-center transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 ${spacing}`}
            >
              {mark ? (
                <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="size-4.5">
                  <path d={mark.path} />
                </svg>
              ) : (
                link.label
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
