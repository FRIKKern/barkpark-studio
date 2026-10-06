import {defineArrayMember, defineField, defineType} from 'sanity'

// J44's very long document: 200 fields + a 300-item array. The same shape as
// fixtures/barkpark-schema/longform.json (scripts/gen-longform.mjs); keep in step.
const KINDS = ['string', 'text', 'number', 'boolean', 'string'] as const
const pad = (i: number) => String(i).padStart(3, '0')

export const longform = defineType({
  name: 'longform',
  title: 'Longform',
  type: 'document',
  fields: [
    defineField({name: 'title', type: 'string'}),
    ...Array.from({length: 199}, (_, n) => {
      const i = n + 2
      const type = KINDS[i % KINDS.length]!
      return defineField({name: `f${pad(i)}`, title: `Field ${pad(i)}`, type, ...(type === 'text' ? {rows: 2} : {})})
    }),
    defineField({
      name: 'rows',
      type: 'array',
      of: [
        defineArrayMember({
          name: 'row',
          type: 'object',
          fields: [defineField({name: 'title', type: 'string'}), defineField({name: 'note', type: 'string'})],
          preview: {select: {title: 'title', subtitle: 'note'}},
        }),
      ],
    }),
  ],
})
