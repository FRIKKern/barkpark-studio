import {defineArrayMember, defineField, defineType} from 'sanity'

// The field-type matrix (scout 2026-10-13): one document with every built-in type and
// the common options ours must draw and edit as Sanity does. Its Barkpark twin is
// fixtures/barkpark-schema/fieldTypes.json; the seed is fixtures/seed.ndjson's field-types-01.
export const fieldTypes = defineType({
  name: 'fieldTypes',
  title: 'Field types',
  type: 'document',
  fieldsets: [{name: 'size', title: 'Size', options: {columns: 2}}],
  initialValue: () => ({count: 3}),
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'choice', type: 'string', options: {list: [{title: 'Alpha', value: 'a'}, {title: 'Beta', value: 'b'}, {title: 'Gamma', value: 'c'}], layout: 'dropdown'}}),
    defineField({name: 'agree', type: 'boolean', options: {layout: 'checkbox'}}),
    defineField({name: 'day', type: 'date', options: {dateFormat: 'DD.MM.YYYY'}}),
    defineField({name: 'at', type: 'datetime', options: {dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm', timeStep: 15}}),
    defineField({name: 'handle', type: 'slug', options: {source: 'title', maxLength: 20}, validation: (r) => r.required()}),
    defineField({name: 'place', type: 'geopoint'}),
    defineField({name: 'weakRef', title: 'Weak reference', type: 'reference', to: [{type: 'post'}], weak: true, options: {disableNew: true}}),
    defineField({name: 'colours', type: 'array', of: [defineArrayMember({type: 'string'})], options: {list: [{title: 'Red', value: 'red'}, {title: 'Green', value: 'green'}, {title: 'Blue', value: 'blue'}], layout: 'grid'}}),
    defineField({
      name: 'cards',
      type: 'array',
      options: {layout: 'grid'},
      of: [defineArrayMember({type: 'object', name: 'card', fields: [defineField({name: 'label', type: 'string'}), defineField({name: 'note', type: 'text', rows: 2})]})],
    }),
    // An array whose items hold an array of their own: the item dialog opens over the item dialog.
    defineField({
      name: 'sections',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'section',
          fields: [
            defineField({name: 'title', type: 'string'}),
            defineField({name: 'items', type: 'array', of: [defineArrayMember({type: 'object', name: 'item', fields: [defineField({name: 'label', type: 'string'}), defineField({name: 'note', type: 'text', rows: 2})]})]}),
          ],
        }),
      ],
    }),
    // Six member types: Sanity's insert menu (with search past its threshold).
    defineField({
      name: 'blocks',
      type: 'array',
      of: [
        defineArrayMember({type: 'object', name: 'hero', title: 'Hero', fields: [defineField({name: 'heading', type: 'string'})]}),
        defineArrayMember({type: 'object', name: 'quote', title: 'Quote', fields: [defineField({name: 'heading', type: 'string'})]}),
        defineArrayMember({type: 'object', name: 'cta', title: 'Call to action', fields: [defineField({name: 'heading', type: 'string'})]}),
        defineArrayMember({type: 'object', name: 'stat', title: 'Stat', fields: [defineField({name: 'heading', type: 'string'})]}),
        defineArrayMember({type: 'object', name: 'faq', title: 'FAQ', fields: [defineField({name: 'heading', type: 'string'})]}),
        defineArrayMember({type: 'object', name: 'logo', title: 'Logo strip', fields: [defineField({name: 'heading', type: 'string'})]}),
      ],
    }),
    defineField({
      name: 'address',
      type: 'object',
      fieldsets: [{name: 'where', title: 'Where', options: {collapsible: true, collapsed: false, columns: 2}}],
      fields: [
        defineField({name: 'street', type: 'string', fieldset: 'where'}),
        defineField({name: 'city', type: 'string', fieldset: 'where'}),
        defineField({name: 'zip', type: 'string'}),
      ],
    }),
    defineField({name: 'width', type: 'number', fieldset: 'size'}),
    defineField({name: 'height', type: 'number', fieldset: 'size'}),
    defineField({name: 'count', type: 'number', validation: (r) => r.integer().min(0).max(10)}),
    defineField({name: 'hiddenNote', title: 'Shown when agreed', type: 'string', hidden: ({document}) => !document?.agree}),
    defineField({name: 'lockedNote', title: 'Locked when agreed', type: 'string', readOnly: ({document}) => !!document?.agree}),
    defineField({name: 'attachment', type: 'file', options: {accept: 'image/*'}}),
    defineField({name: 'photo', type: 'image', options: {hotspot: true, metadata: ['palette', 'exif']}}),
  ],
})
