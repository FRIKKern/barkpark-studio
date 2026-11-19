// When another editor's frames wait for this editor's own change (PortableTextInput's hold):
// the editor emits a paste or split as a `mutation` up to a second after its patches. Given
// in that gap, their patches landed on the wrong letters of a block it split
// (task-ab6d751fa53fbda5), so they wait, as frames, until it is emitted.
//
// Typing does not hold them. Held while a word is typed, their frames came as one jump with
// this editor's own words (echoed back in their frames) in it, and those went onto the screen
// again (task-30946f2255a30d93: two editors typing in one block, "slowlyfrom").

/** How long their frames wait at most for this editor's change to be emitted. */
export const MINE_WAIT_MS = 3000

/** Whether an editor patch (its `patch` event) holds their frames: anything but typing in a span. */
export const startsHold = (patch: {type?: string}) => patch.type !== 'diffMatchPatch'

/** Whether their frames still wait: a held change not emitted yet (`since`: when it began), within MINE_WAIT_MS. */
export const waitsForMine = (since: number, now = Date.now()) => since > 0 && now - since < MINE_WAIT_MS
