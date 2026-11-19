import type { ApiBoardPerson, ApiDiscordToDo } from '../../lib/api/api'
import { panelLabel } from './boardChrome'

/**
 * Whose Discord Officers role to change after a board change.
 *
 * The site doesn't change it: the role sits above the bot, and the club keeps it by
 * hand. So every board write answers with this list instead, and it's shown until the
 * next change.
 */
export function DiscordToDo({ todo }: { todo: ApiDiscordToDo }) {
  if (todo.give.length === 0 && todo.take.length === 0) return null

  return (
    <div className="mt-3">
      <p className={`${panelLabel} mb-1.5`}>IN DISCORD, BY HAND</p>
      <ul className="space-y-1 text-[13px] leading-[1.6] text-pretty">
        {todo.give.length > 0 && (
          <li>
            Give the Officers role to <People people={todo.give} />.
          </li>
        )}
        {todo.take.length > 0 && (
          <li>
            Take the Officers role from <People people={todo.take} />.
          </li>
        )}
      </ul>
    </div>
  )
}

function People({ people }: { people: ApiBoardPerson[] }) {
  return people.map((person, index) => (
    <span key={person.id}>
      {index > 0 && (index === people.length - 1 ? ' and ' : ', ')}
      <strong className="font-semibold text-base-content">{person.fullName}</strong>
      <span className="wrap-anywhere text-faint">
        {person.discordUsername
          ? ` (@${person.discordUsername})`
          : ' (no Discord on file)'}
      </span>
    </span>
  ))
}
