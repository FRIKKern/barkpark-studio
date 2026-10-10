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
  'reference', 'image', 'file', 'arrayOf', 'composite', 'codelist', 'localizedText', 'richText', 'markdown', 'json', 'source',
] as const

/** Every key the studio reads on a field, and what it means. */
export const FIELD_KEYS = {
  name: 'The field\'s name (its path segment).',
  title: 'Its label.',
  type: 'One of the field types.',
  refType: 'reference: the type it points to.',
  to: 'reference: the types it may point to, [{type}].',
  rows: 'text: the textarea\'s height.',
  of: 'arrayOf: the member field.',
  fields: 'composite, image: the subfields.',
  options: 'Type-specific: select\'s choices (a list), slug\'s source, image\'s hotspot, file\'s accept, reference\'s filter, …',
  layout: 'arrayOf: "grid" or "list".',
  group: 'The field group (tab) it shows in.',
  validation: 'A rule, or a list of rules.',
  initialValue: 'An array member\'s starting values.',
  languages: 'localizedText: the languages it holds.',
  fallbackChain: 'localizedText: the order readers fall back through.',
  editor: 'richText: "blocks" for Barkpark\'s block editor.',
  codelistId: 'codelist: "<plugin>:<name>".',
  preview: 'An array item\'s row: {title, subtitle} subfield names.',
  visibleWhen: 'Shown only when {field, operator, value, scope?} holds.',
  readOnly: 'true, or a condition like visibleWhen.',
} satisfies Record<keyof Field, string>

/** Keys Barkpark reads on a field that the studio passes through as they are. */
export const BARKPARK_FIELD_KEYS = {
  ordered: 'arrayOf: adds reordering.',
  blocks: 'richText: the block vocabulary for Barkpark\'s editor.',
  format: 'localizedText: "plain" or "rich".',
  refTypeTolerant: 'reference: resolve the target as any type.',
  refTypes: 'reference: the types it may point to (another spelling of `to`).',
  description: 'Help text in Studio.',
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
  min: 'At least this many characters, items, or this number.',
  max: 'At most this many characters, items, or this number.',
  pattern: 'A regular expression the text (or a slug\'s current) must match; Barkpark enforces it on write.',
  unique: 'arrayOf: no two items with the same reference or value.',
  level: '"error" (blocks publishing, the default), "warning" or "info".',
  message: 'What to say instead of the default text.',
} satisfies Record<keyof Rule, string>
export const RULE_LEVELS = ['error', 'warning', 'warn', 'info']

/** A schema file's keys (server/schemas.ts reads them; Barkpark adds `visibility` and `actions`). */
export const SCHEMA_KEYS = {
  name: 'The type\'s name.',
  title: 'Its label.',
  fields: 'Its fields.',
  listPreview: 'A list row: {title, subtitle, media} field names.',
  list_preview: 'listPreview, as Barkpark spells it.',
  groups: 'Field groups (tabs): [{name, title, default?}].',
  initialValues: 'A new document\'s starting values.',
  initial_values: 'initialValues, as Barkpark spells it.',
  desk: 'Desk settings: orderings, views; hidden: true keeps the type off Barkpark\'s desk while its URLs still open (barkpark#22789).',
  singleton: 'One document, whose id is the type\'s name.',
  layout: 'The Expectation for PortableDoc types (decision 0004).',
  prefill: 'A new PortableDoc document\'s starting blocks.',
} satisfies Record<keyof RawSchema, string>
export const BARKPARK_SCHEMA_KEYS = {
  visibility: '"public" or "private": who may read its documents.',
  actions: 'Barkpark document actions the type declares.',
  icon: 'Its icon.',
  kind: '"document" or "object" (a named type other schemas use as a field type).',
  owner_scoped: 'Documents scoped to their owner.',
  desk_groups: 'Desk groups.',
  cross_validations: 'Cross-field rules: [{name, title, rule, level, fields}].',
  cors_origins: 'Origins allowed to read it from a browser.',
}

type JsonSchema = Record<string, unknown>
const described = (keys: Record<string, string>, extra: Record<string, JsonSchema> = {}) =>
  Object.fromEntries(Object.entries(keys).map(([k, description]) => [k, {description, ...extra[k]}]))

/** The JSON Schema for one file in fixtures/barkpark-schema. */
export function fixtureJsonSchema(): JsonSchema {
  const rule = {type: 'object', additionalProperties: false, properties: described(RULE_KEYS, {required: {type: 'boolean'}, min: {type: 'number'}, max: {type: 'number'}, pattern: {type: 'string', format: 'regex'}, unique: {type: 'boolean'}, level: {enum: RULE_LEVELS}, message: {type: 'string'}})}
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
      ...described(SCHEMA_KEYS, {name: {type: 'string'}, title: {type: 'string'}, fields: {type: 'array', items: {$ref: '#/definitions/field'}}, singleton: {type: 'boolean'}, desk: {type: 'object', properties: {hidden: {type: 'boolean', description: 'Off the desk; the type still opens from a direct URL.'}}}}),
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
