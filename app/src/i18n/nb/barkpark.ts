// Barkpark's own Studio Norwegian (api/priv/gettext/nb_NO/LC_MESSAGES/default.po) where
// it differs from the chunks above: spread last, so the Studio speaks LiveView's words.
// Regenerate by diffing the chunks against that .po when either changes.
export default {
  'Required': 'Påkrevd',
  'Show more': 'Vis flere',
  // D13, paper_editor.ex's linked master block
  'Detach': 'Koble fra',
  'Detach: copy the published version readers see in as plain blocks': 'Koble fra: kopier inn den publiserte versjonen leserne ser, som vanlige blokker',
  "Linked master — it shows the master's content. Edit the master, or Detach to edit it here.": 'Koblet mal – den viser malens innhold. Rediger malen, eller koble fra for å redigere her.',
  'Pin': 'Fest',
  "Pin to the master's published version": 'Fest til malens publiserte versjon',
  'Unpin': 'Løsne',
  "Unpin: follow the master's latest": 'Løsne: følg malens nyeste versjon',
  'Pinned to a published version of the master — readers see exactly this. Unpin to follow the master, or Detach to edit it here.': 'Festet til en publisert versjon av malen – leserne ser akkurat dette. Løsne for å følge malen, eller koble fra for å redigere her.',
  // B01: MediaVisibilityCopy (media_visibility_copy.ex): the API sends it in English and
  // the Studio translates it at render, as LiveView does.
  "Public — within this scope's sharing": 'Offentlig — innenfor delingen i dette området',
  "Public means readable within this scope's sharing, not world-readable. Anonymous readers (a website's bare <img>) reach this asset only while the scope carries a :media share; marking an asset public opens no door on its own.": 'Offentlig betyr lesbar innenfor delingen i dette området, ikke for hele verden. Anonyme lesere (en nettsides <img>) når denne filen bare mens området har en :media-deling; å merke en fil som offentlig åpner ingen dør alene.',
  'shared — this scope carries a :media share, so anonymous reads of its public assets resolve': 'delt — området har en :media-deling, så anonyme lesere når de offentlige filene',
  'not shared — this scope carries NO :media share, so anonymous reads get 403 even for a public asset': 'ikke delt — området har INGEN :media-deling, så anonyme lesere får 403 selv for en offentlig fil',
} satisfies Record<string, string>
