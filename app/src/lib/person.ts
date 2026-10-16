import {useQuery} from '@tanstack/react-query'
import {peopleNamesQuery} from './people'
import {meQuery} from './session'

// One way to name a person everywhere the studio shows one (presence avatars, comment
// authors and mentions, task assignees and creators, the footer's last actor, history
// authors, the user menu): the name Barkpark gives them, else their email's local part.
// Barkpark names you yourself (/v1/auth/me, #622); the workspace roster carries no names
// yet (Barkpark board ask task-2eae7f4056c3a970; members' display_name is read as soon as it lands).

/** An email's local part ("ada@x.io" reads "ada"); anything else (an API token's label) as it is. */
export const localPart = (who: string) => who.replace(/@.*/, '')

/** First and last word's initials, as Sanity's avatars ("studio-editor-a" reads SA). */
export function initialsOf(name: string) {
  const words = localPart(name).split(/[\s._-]+/).filter(Boolean)
  return [words[0], words.length > 1 ? words.at(-1) : undefined].filter((w): w is string => !!w).map((w) => w[0]!.toUpperCase()).join('')
}

/** What to call `who` (an email, or a label that is not one). */
export function usePersonName(who: string | null | undefined): string | null {
  const {data: names} = useQuery({...peopleNamesQuery, enabled: !!who && who.includes('@')})
  const {data: me} = useQuery(meQuery)
  if (!who) return null
  if (!who.includes('@')) return who
  return names?.[who] || (me?.email === who && me.name) || localPart(who)
}
