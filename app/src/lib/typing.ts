// When this page last heard a key: a screen that appears under the editor's fingers (the
// sign-in form when another tab signs out) does not take the rest of their words.
let last = 0
if (typeof window !== 'undefined') addEventListener('keydown', () => void (last = Date.now()), true)

/** Whether a key went down in this page within `ms`. */
export const typedWithin = (ms: number) => Date.now() - last < ms
