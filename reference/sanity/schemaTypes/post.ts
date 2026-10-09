import {defineArrayMember, defineField, defineType} from 'sanity'
import {CountedInput} from '../plugin'

// Fixture type: one field of every kind the parity journeys exercise. Titles are
// spelled out where Barkpark's fixture names them (post.json), so labels read the same.
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
    // J13: a warning (never blocks publish).
    defineField({name: 'excerpt', type: 'text', rows: 3, group: 'content', components: {input: CountedInput}, validation: (r) => r.max(160).warning('Long excerpts get cut off in previews')}),
    defineField({name: 'author', type: 'reference', to: [{type: 'author'}], group: 'content'}),
    defineField({
      name: 'categories',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({type: 'reference', to: [{type: 'category'}]})],
    }),
    defineField({
      name: 'mainImage',
      title: 'Main image',
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
    defineField({name: 'featuredNote', title: 'Featured note', type: 'string', group: 'meta', hidden: ({document}) => !document?.featured}),
    defineField({name: 'reviewNote', title: 'Review note', type: 'text', rows: 2, group: 'meta', readOnly: ({document}) => document?.stage === 'done'}),
    // File field (J36).
    defineField({name: 'attachment', type: 'file', group: 'meta', options: {accept: 'application/pdf'}}),
    // Object array with two member types (J33).
    defineField({
      name: 'links',
      type: 'array',
      group: 'meta',
      of: [
        defineArrayMember({
          name: 'externalLink',
          title: 'External link',
          type: 'object',
          initialValue: {title: 'Read more'}, // J18: initial values on new array items
          fields: [defineField({name: 'title', type: 'string'}), defineField({name: 'url', title: 'URL', type: 'url'})],
        }),
        defineArrayMember({
          name: 'docLink',
          title: 'Document link',
          type: 'object',
          initialValue: {title: 'Read more'},
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
    defineField({name: 'publishedAt', title: 'Published at', type: 'datetime', group: 'meta'}),
    defineField({name: 'featured', type: 'boolean', group: 'meta', initialValue: false}),
    defineField({name: 'rating', type: 'number', group: 'meta', validation: (r) => r.min(0).max(5)}),
    // J13: a rule only Barkpark's check runs for us (an array's length), shown from its advisory.
    defineField({name: 'tags', type: 'array', group: 'meta', of: [{type: 'string'}], options: {layout: 'tags'}, validation: (r) => r.max(3).warning()}),
    // A plain string array: reorderable rows (J34).
    defineField({name: 'highlights', type: 'array', group: 'meta', of: [{type: 'string'}]}),
    // J30 + barkpark#22554: a field shown by a sibling in the same object (Sanity's `parent`).
    defineField({
      name: 'cta',
      title: 'Call to action',
      type: 'object',
      group: 'meta',
      fields: [
        defineField({name: 'kind', type: 'string', options: {list: [{title: 'Link', value: 'url'}, {title: 'Page', value: 'internal'}]}}),
        defineField({name: 'url', title: 'URL', type: 'url', hidden: ({parent}) => parent?.kind !== 'url'}),
        defineField({name: 'page', type: 'reference', to: [{type: 'post'}], hidden: ({parent}) => parent?.kind !== 'internal'}),
      ],
    }),
    defineField({
      name: 'seo',
      title: 'SEO',
      type: 'object',
      group: 'meta',
      // J13: an error inside a collapsed object, and an info.
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({name: 'metaTitle', title: 'Meta title', type: 'string', validation: (r) => r.max(60)}),
        defineField({name: 'metaDescription', title: 'Meta description', type: 'text', rows: 2, validation: (r) => r.min(50).info('Search results show about 150 characters')}),
      ],
    }),
  ],
  // J55: the type's own orderings, offered first in the list's "…" menu.
  orderings: [
    {title: 'Publish date, newest', name: 'publishedAtDesc', by: [{field: 'publishedAt', direction: 'desc'}]},
    {title: 'Rating, highest', name: 'ratingDesc', by: [{field: 'rating', direction: 'desc'}]},
  ],
  preview: {select: {title: 'title', subtitle: 'author.name', media: 'mainImage'}},
})
