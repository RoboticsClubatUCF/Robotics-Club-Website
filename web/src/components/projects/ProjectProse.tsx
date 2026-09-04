import type { ReactNode } from 'react'
import type { Block, Inline } from '../../lib/projects/projectProse'
import { isExternalHref, parseProse } from '../../lib/projects/projectProse'

/**
 * A project's write-up, set as markdown.
 *
 * Nothing here builds HTML from a string. `parseProse` returns a tree and this walks it into React
 * elements, so every piece of a write-up is escaped by React on the way out. That is the whole
 * security story for a field a lead types and the public reads, and it is why the renderer is
 * written rather than installed — see `lib/projects/projectProse.ts`.
 *
 * The one prop is how a paragraph is set, including the space above it. The other blocks size
 * themselves off that: a page reading at `text-sm` wants headings a step up from its own body, not
 * a fixed scale that fights it.
 */
export function ProjectProse({
  description,
  className,
}: {
  description: string | null
  /**
   * How one paragraph is set, including the space above it — the margin is on
   * every paragraph rather than between them, so the first one is also spaced
   * off whatever it follows. A project's own page reads at `mt-5`.
   */
  className: string
}) {
  if (!description) return null

  const blocks = parseProse(description)
  if (blocks.length === 0) return null

  return (
    <>
      {blocks.map((block, index) => (
        <ProseBlock key={index} block={block} className={className} />
      ))}
    </>
  )
}

function ProseBlock({ block, className }: { block: Block; className: string }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p className={className}>
          <ProseInline nodes={block.children} />
        </p>
      )

    case 'heading': {
      /* An `h3` at the shallowest, and never an `h1` or `h2`: on a project's
         page the title is the `h1` and this prose sits under it, so a write-up
         that could mint its own top-level heading would break the outline a
         screen reader reads the page by. Three levels of markdown map onto
         three levels of subheading. */
      const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1]
      const size = (['text-lg', 'text-base', 'text-sm'] as const)[block.level - 1]

      return (
        <Tag
          className={`text-base-content mt-6 mb-2 ${size} font-semibold tracking-[-0.01em]`}
        >
          <ProseInline nodes={block.children} />
        </Tag>
      )
    }

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          className={`${className} ${
            block.ordered ? 'list-decimal' : 'list-disc'
          } pl-5 marker:text-faint`}
        >
          {block.items.map((item, index) => (
            <li key={index} className="mt-1">
              <ProseInline nodes={item} />
            </li>
          ))}
        </Tag>
      )
    }

    case 'quote':
      return (
        <blockquote className={`${className} border-rule border-l-2 pl-4`}>
          <ProseInline nodes={block.children} />
        </blockquote>
      )

    case 'code':
      /* Scrolls inside its own box rather than widening the reading column: a
         pasted eighty-character line must not put a horizontal scrollbar on the
         page itself. */
      return (
        <pre className="border-rule bg-base-200 mt-4 overflow-x-auto border p-3">
          <code className="font-mono text-[12px] leading-[1.6]">{block.text}</code>
        </pre>
      )

    case 'rule':
      return <hr className="border-rule mt-6" />
  }
}

function ProseInline({ nodes }: { nodes: Inline[] }): ReactNode {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case 'text':
            return node.text

          case 'strong':
            return (
              <strong key={index} className="font-semibold">
                <ProseInline nodes={node.children} />
              </strong>
            )

          case 'em':
            return (
              <em key={index}>
                <ProseInline nodes={node.children} />
              </em>
            )

          case 'code':
            return (
              <code
                key={index}
                className="border-rule bg-base-200 rounded-[2px] border px-1 py-0.5 font-mono text-[0.9em]"
              >
                {node.text}
              </code>
            )

          case 'link': {
            /* A write-up's links leave the site the way `/ RESOURCES`' do, and
               carry the same `rel`. A relative one stays in the tab, and is a
               plain anchor rather than a router `Link` — it is rare enough that
               a full page load is the honest cost of not threading a router
               through a text renderer. */
            const external = isExternalHref(node.href)
            return (
              <a
                key={index}
                href={node.href}
                {...(external
                  ? { target: '_blank', rel: 'noreferrer noopener' }
                  : {})}
                className="text-primary underline underline-offset-2"
              >
                <ProseInline nodes={node.children} />
              </a>
            )
          }
        }
      })}
    </>
  )
}
