import barkpark from './nb/barkpark'
import document from './nb/document'
import fields from './nb/fields'
import media from './nb/media'
import search from './nb/search'
import structure from './nb/structure'

// B01: the Studio's Norwegian, keyed by the English in the code (lib/i18n.tsx).
// Sources: Barkpark's own Studio (api/priv/gettext/nb_NO) wins wherever it has the
// string (nb/barkpark.ts, spread last), then Sanity's nb-NO pack (@sanity/locale-nb-no,
// MIT) where our English is Sanity's, then ours.
export const NB: Record<string, string> = {...structure, ...document, ...fields, ...search, ...media, ...barkpark}
