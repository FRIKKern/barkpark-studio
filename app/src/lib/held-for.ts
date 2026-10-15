// Whose edits a page holds (task-03ca6c0c9a79adf1): the editor signed in when they were
// typed. A lost session keeps them for that editor (J48); anyone else signing in on the
// page neither sees nor sends them. Pure, so the rule has a fast test (lib/edits.ts uses it).

/** Told each sign-in's email (null: signed out); answers whether the held edits stay. */
export function heldFor(): (email: string | null) => boolean {
  let owner: string | null = null
  return (email) => {
    if (!email) return true // signed out: held for whoever signs in next, if that is them
    const theirs = !owner || owner === email
    owner = email
    return theirs
  }
}
