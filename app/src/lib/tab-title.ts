// The browser tab's title: the document's words, then " | " and the studio's name (lib/studio-name.ts). Bidi embedding,
// override and isolate controls (U+202A–U+202E, U+2066–U+2069) are dropped from the words: an
// unterminated right-to-left override in a title drew the suffix reversed in the tab and the
// history (task-f906a8d1660ec28a). Inside the page each place keeps it within its own block.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g

export const tabTitle = (title: string, studio = 'Barkpark Studio') => `${title.replace(BIDI_CONTROLS, '')} | ${studio}`
