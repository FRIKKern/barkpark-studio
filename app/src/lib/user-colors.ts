// Sanity's user colours (@sanity/color 3.0.9, as its studio assigns them; it leaves out red, green and gray): an author's
// changes are tinted with their hue (light: 100 on 700, dark: 900 on 200; avatar 500).

export const USER_HUES = {
  blue: {100: '#e5edff', 200: '#dbe5ff', 500: '#556bfc', 700: '#2927aa', 900: '#161a41'},
  purple: {100: '#f1ebff', 200: '#ece1fe', 500: '#8f57ef', 700: '#4c1a9e', 900: '#23173f'},
  magenta: {100: '#fde8ef', 200: '#fcdee9', 500: '#e72767', 700: '#7c1342', 900: '#341325'},
  orange: {100: '#ffeadb', 200: '#ffddc7', 500: '#fa6400', 700: '#7c3404', 900: '#32160b'},
  yellow: {100: '#fcf3bb', 200: '#f9e994', 500: '#d28a04', 700: '#653a0b', 900: '#271a11'},
  cyan: {100: '#c5fcfc', 200: '#96f8f8', 500: '#04b8be', 700: '#024950', 900: '#072227'},
} as const

export type UserHue = keyof typeof USER_HUES
const NAMES = Object.keys(USER_HUES) as UserHue[]

/** A stable hue per author (the same name always gets the same colour). */
export function userHue(author: string): UserHue {
  let h = 0
  for (const ch of author) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NAMES[h % NAMES.length]!
}

/** CSS custom properties for an author: --user-100 … --user-900. */
export const userColorVars = (author: string) =>
  Object.fromEntries(Object.entries(USER_HUES[userHue(author)]).map(([k, v]) => [`--user-${k}`, v])) as Record<string, string>
