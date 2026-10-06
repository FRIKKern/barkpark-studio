import {defineArrayMember, defineField, defineType} from 'sanity'

// Fixture type: one field of every kind the parity journeys exercise.
export const post = defineType({
  name: 'post',
  title: 'Post',
  type: 'document',
  groups: [
    {name: 'content', title: 'Content', default: true},
    {name: 'meta', title: 'Meta'},
  ],
  fields: [
    defineField({name: 'title', type: 'string', group: 'content', validation: (r) => r.required().max(120)}),
    defineField({name: 'slug', type: 'slug', group: 'content', options: {source: 'title'}, validation: (r) => r.required()}),
    defineField({name: 'excerpt', type: 'text', rows: 3, group: 'content'}),
    defineField({name: 'author', type: 'reference', to: [{type: 'author'}], group: 'content'}),
    defineField({
      name: 'categories',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({type: 'reference', to: [{type: 'category'}]})],
    }),
    defineField({
      name: 'mainImage',
      type: 'image',
      group: 'content',
      options: {hotspot: true},
      fields: [defineField({name: 'alt', type: 'string', title: 'Alternative text'})],
    }),
    defineField({
      name: 'body',
      type: 'array',
      group: 'content',
      of: [
        defineArrayMember({
          type: 'block',
          // Inline object + internal-link annotation (J35, J39).
          of: [
            defineArrayMember({
              name: 'chip',
              type: 'object',
              fields: [
                defineField({name: 'text', type: 'string'}),
                defineField({name: 'tone', type: 'string', options: {list: ['neutral', 'positive', 'caution']}}),
              ],
            }),
          ],
          marks: {
            annotations: [
              defineArrayMember({name: 'link', type: 'object', fields: [defineField({name: 'href', type: 'url'})]}),
              defineArrayMember({
                name: 'internalLink',
                type: 'object',
                fields: [defineField({name: 'reference', type: 'reference', to: [{type: 'post'}, {type: 'author'}]})],
              }),
            ],
          },
        }),
        defineArrayMember({type: 'image', options: {hotspot: true}}),
        defineArrayMember({
          name: 'callout',
          type: 'object',
          fields: [
            defineField({name: 'tone', type: 'string', options: {list: ['info', 'warning', 'danger']}}),
            defineField({name: 'text', type: 'text', rows: 2}),
          ],
        }),
      ],
    }),
    // Select lists, radio and dropdown (J31).
    defineField({
      name: 'stage',
      type: 'string',
      group: 'meta',
      options: {list: ['idea', 'writing', 'review', 'done'], layout: 'radio', direction: 'horizontal'},
    }),
    defineField({
      name: 'format',
      type: 'string',
      group: 'meta',
      options: {
        list: [
          {title: 'Article', value: 'article'},
          {title: 'Tutorial', value: 'tutorial'},
          {title: 'News brief', value: 'brief'},
        ],
        layout: 'dropdown',
      },
    }),
    // Conditional fields (J30): shown only when featured; locked once done.
    defineField({name: 'featuredNote', type: 'string', group: 'meta', hidden: ({document}) => !document?.featured}),
    defineField({name: 'reviewNote', type: 'text', rows: 2, group: 'meta', readOnly: ({document}) => document?.stage === 'done'}),
    // File field (J36).
    defineField({name: 'attachment', type: 'file', group: 'meta'}),
    // Object array with two member types (J33).
    defineField({
      name: 'links',
      type: 'array',
      group: 'meta',
      of: [
        defineArrayMember({
          name: 'externalLink',
          type: 'object',
          fields: [defineField({name: 'title', type: 'string'}), defineField({name: 'url', type: 'url'})],
        }),
        defineArrayMember({
          name: 'docLink',
          type: 'object',
          fields: [
            defineField({name: 'title', type: 'string'}),
            defineField({name: 'target', type: 'reference', to: [{type: 'post'}]}),
          ],
          preview: {select: {title: 'title', subtitle: 'target.title'}},
        }),
      ],
    }),
    // Odd reference states (J27): a filtered reference and one with two target types.
    defineField({
      name: 'reviewer',
      type: 'reference',
      group: 'meta',
      to: [{type: 'author'}],
      options: {filter: 'name != $skip', filterParams: {skip: 'Alan Turing'}},
    }),
    defineField({name: 'related', type: 'reference', group: 'meta', to: [{type: 'post'}, {type: 'author'}]}),
    defineField({name: 'publishedAt', type: 'datetime', group: 'meta'}),
    defineField({name: 'featured', type: 'boolean', group: 'meta', initialValue: false}),
    defineField({name: 'rating', type: 'number', group: 'meta', validation: (r) => r.min(0).max(5)}),
    defineField({name: 'tags', type: 'array', group: 'meta', of: [{type: 'string'}], options: {layout: 'tags'}}),
    // A plain string array: reorderable rows (J34).
    defineField({name: 'highlights', type: 'array', group: 'meta', of: [{type: 'string'}]}),
    defineField({
      name: 'seo',
      type: 'object',
      group: 'meta',
      fields: [
        defineField({name: 'metaTitle', type: 'string'}),
        defineField({name: 'metaDescription', type: 'text', rows: 2}),
      ],
    }),
  ],
  preview: {select: {title: 'title', subtitle: 'author.name', media: 'mainImage'}},
})
