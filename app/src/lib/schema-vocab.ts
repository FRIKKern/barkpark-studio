import type {Field, Rule} from './data'
import type {RawSchema} from '../server/schemas'

// What a schema file in fixtures/barkpark-schema may say, from what the studio reads and
// Barkpark's docs/contracts/schema-reference.md (barkpark#22640) names
// (task-5012fe19eb89a5c6): the JSON Schema editors check those files against is made
// from this (scripts/fixture-schema.mjs), and schema-vocab.test.ts keeps all three
// in step: these types, the form's field registry and the generated file. The key
// maps are typed `satisfies Record<keyof …>`: a key added to Field, Rule or RawSchema
// doesn't compile until it is described here, and one described here must exist there.
// Type-only imports: this module runs as plain Node too (strip-types), no dependencies.

/** The field types the form draws (the switch in components/Fields.tsx). */
export const FIELD_TYPES = [
  'string', 'text', 'number', 'integer', 'float', 'boolean', 'date', 'datetime', 'time', 'url', 'email', 'slug', 'select', 'tags', 'color',
  'reference', 'image', 'file', 'arrayOf', 'composite', 'geopoint', 'codelist', 'localizedText', 'richText', 'markdown', 'json', 'source',
] as const

/** Every key the studio reads on a field, and what it means. */
export const FIELD_KEYS = {
  name: 'The field\'s name (its path segment).',
  title: 'Its label.',
  description: 'Help text under the label.',
  type: 'One of the field types.',
  refType: 'reference: the type it points to.',
  to: 'reference: the types it may point to, [{type}].',
  rows: 'text: the textarea\'s height.',
  of: 'arrayOf: the member field.',
  fields: 'composite, image: the subfields.',
  options: 'Type-specific: select\'s choices (a list, or {list, direction} as Sanity\'s), slug\'s source, image\'s hotspot, file\'s accept, reference\'s filter, an array\'s insertMenu ({filter, groups, views: list/grid, showIcons}) and collapseItemsAfter, …',
  layout: 'arrayOf: "grid" or "list".',
  group: 'The field group (tab) it shows in.',
  validation: 'A rule, or a list of rules.',
  initialValue: 'An array member\'s starting values.',
  languages: 'localizedText: the languages it holds.',
  fallbackChain: 'localizedText: the order readers fall back through.',
  editor: 'richText: "blocks" for Barkpark\'s block editor.',
  format: 'richText: "portableText" or "portableDoc", the stored format. localizedText: "plain" or "rich".',
  blocks: 'richText: the block vocabulary (styles, lists, marks, annotations, of, inline: inline objects [{name, fields}]). The Portable Text input takes its toolbar from it.',
  codelistId: 'codelist: "<plugin>:<name>".',
  preview: 'An array item\'s row: {title, subtitle} subfield names.',
  visibleWhen: 'Shown only when {field, operator, value, scope?} holds.',
  hidden: 'true keeps the field out of the form whatever visibleWhen says; its value stays (a manual order\'s orderRank).',
  readOnly: 'true, or a condition like visibleWhen.',
  fieldsets: 'composite: Sanity\'s fieldsets, [{name, title, options: {collapsible, collapsed, columns}}].',
  fieldset: 'The fieldset (of its composite) it shows in.',
  weak: 'reference: Sanity\'s weak reference: a pick stores {_ref, _weak: true}, as Sanity\'s.',
  deprecated: 'Sanity\'s deprecated, {reason}: a "deprecated" badge by the title and the reason under it; the field stays editable. On a richText blocks.of / blocks.inline entry: shown disabled in Insert, the reason its tooltip. An array member keeps it (Sanity\'s array menu offers it as usual).',
  namedType: 'An array member or composite that is a named object type: Barkpark sets it when it expands the type. Its item row draws that type\'s icon. "code" makes it Sanity\'s code field (options: language, languageAlternatives, withFilename). "table" makes it Sanity\'s table field (options: rowType).',
} satisfies Record<keyof Field, string>

/** Keys Barkpark reads on a field that the studio passes through as they are. */
export const BARKPARK_FIELD_KEYS = {
  ordered: 'arrayOf: adds reordering.',
  refTypeTolerant: 'reference: resolve the target as any type.',
  refTypes: 'reference: the types it may point to (another spelling of `to`).',
  surface: '"body" or "sidebar" (metadata only).',
  encrypted: 'Encrypted at rest.',
  private: 'Per-field read visibility.',
  visibility: 'Per-field read visibility.',
  readable_by: 'Per-field read visibility.',
  onix: 'Passed through for ONIX export.',
  source: 'slug: the field it derives from (also options.source).',
  hotspot: 'image: the focal point (also options.hotspot).',
  alt: 'image: true shows an alt input.',
  version: 'codelist: the pinned version.',
}

/** A validation rule's keys (lib/validation.ts). */
export const RULE_KEYS = {
  required: 'The field must have a value.',
  min: 'At least this many characters, items, or this number. date, datetime: the earliest date (ISO or "now"), studio only.',
  max: 'At most this many characters, items, or this number. date, datetime: the latest date (ISO or "now"), studio only.',
  pattern: 'A regular expression the text (or a slug\'s current) must match; Barkpark enforces it on write.',
  unique: 'arrayOf: no two items with the same reference or value.',
  level: '"error" (blocks publishing, the default), "warning" or "info".',
  message: 'What to say instead of the default text.',
  // Sanity's other rule builders (lib/validation-rules.ts): studio only, as Sanity's; Barkpark stores them and never runs them.
  length: 'Studio only: exactly this many characters, or items (blocks in richText).',
  precision: 'Studio only: number: at most this many decimal places.',
  greaterThan: 'Studio only: number: above this.',
  lessThan: 'Studio only: number: below this.',
  positive: 'Studio only: number: 0 or above (Sanity\'s positive()).',
  negative: 'Studio only: number: below 0 (Sanity\'s negative()).',
  lowercase: 'Studio only: text: all lowercase.',
  uppercase: 'Studio only: text: all uppercase.',
  name: 'Studio only: pattern: the name its message uses instead of the regex.',
  invert: 'Studio only: pattern: the text must NOT match. Barkpark still checks the pattern itself on a save (it reads no invert), so a save is refused or warned on the opposite values until it does.',
  assetRequired: 'Studio only: image, file: a value must hold an asset (alt text alone is not one).',
} satisfies Record<keyof Rule, string>
export const RULE_LEVELS = ['error', 'warning', 'warn', 'info']

/** A schema file's keys (server/schemas.ts reads them; Barkpark adds `visibility` and `actions`). */
export const SCHEMA_KEYS = {
  name: 'The type\'s name.',
  title: 'Its label.',
  icon: 'Its icon, a desk icon name: a list row, reference or search hit with no media draws it, as Sanity draws the type\'s icon.',
  fields: 'Its fields.',
  listPreview: 'A list row: {title, subtitle, media} field names.',
  list_preview: 'listPreview, as Barkpark spells it.',
  groups: 'Field groups (tabs): [{name, title, default?}].',
  fieldsets: 'Sanity\'s fieldsets for the document\'s own fields, as a composite\'s.',
  initialValues: 'A new document\'s starting values.',
  initial_values: 'initialValues, as Barkpark spells it.',
  desk: 'Desk settings: orderings, views; incoming: lists, in the form, of the documents that reference this one, with Add item (Sanity\'s incoming references input); preview, a URL template (:slug, :id) for Presentation; previewView: true or {title} adds a Preview tab; hidden: true keeps the type off Barkpark\'s desk while its URLs still open (barkpark#22789); translations: {languages: [{id, title}], languageField?} makes it a translated type (docs/EXTENDING.md).',
  singleton: 'One document, whose id is the type\'s name.',
  layout: 'The Expectation for PortableDoc types (decision 0004).',
  prefill: 'A new PortableDoc document\'s starting blocks.',
  kind: '"document" or "object" (a named type other schemas use as a field type; never offered for creating).',
} satisfies Record<keyof RawSchema, string>
export const BARKPARK_SCHEMA_KEYS = {
  visibility: '"public" or "private": who may read its documents.',
  actions: 'Barkpark document actions the type declares.',
  owner_scoped: 'Documents scoped to their owner.',
  desk_groups: 'Desk groups.',
  cross_validations: 'Cross-field rules: [{name, title, rule, level, fields}].',
  cors_origins: 'Origins allowed to read it from a browser.',
  readerWrites: 'What a read seat may write on this type (barkpark#22790): {create, patchFields}; studioComment uses it so Viewers comment (J49).',
}

type JsonSchema = Record<string, unknown>
/** `desk.incoming` (lib/incoming-refs.ts): a misspelled key is stored by Barkpark and never read, so the file check names it. */
const INCOMING: JsonSchema = {
  type: 'array',
  description: 'Lists in the form of the documents that reference this one. It is no field and holds no value.',
  items: {
    type: 'object',
    required: ['name', 'types'],
    additionalProperties: false,
    properties: {
      name: {type: 'string', description: 'Its name, unique in the type.'},
      title: {type: 'string', description: 'Its label; the name, start-cased, without one.'},
      description: {type: 'string', description: 'Help text under the label.'},
      group: {type: 'string', description: 'The field group (tab) it shows on; without one, under all fields only.'},
      types: {
        type: 'array',
        minItems: 1,
        description: 'The referring types: {type, by} (by: the reference field, or array of references, that points here), or {view} for the relation a desk.views entry declares.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {type: {type: 'string'}, by: {type: 'string'}, view: {type: 'string'}, title: {type: 'string'}, orderings: {type: 'array', items: {type: 'object', required: ['field'], properties: {field: {type: 'string'}, direction: {enum: ['asc', 'desc']}}}}},
        },
      },
      creationAllowed: {description: 'false: no Add item. A list of template ids: only those. Default true.', anyOf: [{type: 'boolean'}, {type: 'array', items: {type: 'string'}}]},
    },
  },
}
const described = (keys: Record<string, string>, extra: Record<string, JsonSchema> = {}) =>
  Object.fromEntries(Object.entries(keys).map(([k, description]) => [k, {description, ...extra[k]}]))

/** The JSON Schema for one file in fixtures/barkpark-schema. */
export function fixtureJsonSchema(): JsonSchema {
  const flag = {type: 'boolean'}
  const num = {type: 'number'}
  const bound = {anyOf: [{type: 'number'}, {type: 'string'}]}
  const rule = {
    type: 'object',
    additionalProperties: false,
    properties: described(RULE_KEYS, {
      required: flag, min: bound, max: bound, pattern: {type: 'string', format: 'regex'}, unique: flag, level: {enum: RULE_LEVELS}, message: {type: 'string'},
      length: num, precision: num, greaterThan: num, lessThan: num, positive: flag, negative: flag, lowercase: flag, uppercase: flag, name: {type: 'string'}, invert: flag, assetRequired: flag,
    }),
  }
  const field = {
    type: 'object',
    required: ['name', 'type'],
    additionalProperties: false,
    properties: {
      ...described(FIELD_KEYS, {
        name: {type: 'string'},
        title: {type: 'string'},
        type: {enum: [...FIELD_TYPES]},
        refType: {type: 'string'},
        rows: {type: 'number'},
        of: {$ref: '#/definitions/member'},
        fields: {type: 'array', items: {$ref: '#/definitions/field'}},
        group: {type: 'string'},
        deprecated: {type: 'object', required: ['reason'], additionalProperties: false, properties: {reason: {type: 'string'}}},
        validation: {anyOf: [{$ref: '#/definitions/rule'}, {type: 'array', items: {$ref: '#/definitions/rule'}}]},
      }),
      ...described(BARKPARK_FIELD_KEYS, {ordered: {type: 'boolean'}, refTypeTolerant: {type: 'boolean'}}),
    },
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $comment: 'Generated by scripts/fixture-schema.mjs from app/src/lib/schema-vocab.ts. Do not edit.',
    title: 'Barkpark Studio schema type',
    type: 'object',
    required: ['name', 'fields'],
    additionalProperties: false,
    properties: {
      ...described(SCHEMA_KEYS, {name: {type: 'string'}, title: {type: 'string'}, fields: {type: 'array', items: {$ref: '#/definitions/field'}}, singleton: {type: 'boolean'}, desk: {type: 'object', properties: {hidden: {type: 'boolean', description: 'Off the desk; the type still opens from a direct URL.'}, incoming: INCOMING, translations: {type: 'object', description: 'Document translations (Sanity\'s @sanity/document-internationalization): one document per language, linked in a group.', required: ['languages'], additionalProperties: false, properties: {languages: {type: 'array', minItems: 1, description: 'The languages: {id, title}, or the id alone.', items: {anyOf: [{type: 'string'}, {type: 'object', required: ['id'], additionalProperties: false, properties: {id: {type: 'string'}, title: {type: 'string'}}}]}}, languageField: {type: 'string', description: 'The field that holds a document\'s language (default "language"); the form hides it.'}}}}}}),
      ...described(BARKPARK_SCHEMA_KEYS, {visibility: {enum: ['public', 'private']}, kind: {enum: ['document', 'object']}}),
    },
    definitions: {
      rule,
      field,
      /** An array member (`of`): a field without a name. */
      member: {...field, required: ['type']},
    },
  }
}
