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
        defineArrayMember({type: 'block'}),
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
    defineField({name: 'publishedAt', type: 'datetime', group: 'meta'}),
    defineField({name: 'featured', type: 'boolean', group: 'meta', initialValue: false}),
    defineField({name: 'rating', type: 'number', group: 'meta', validation: (r) => r.min(0).max(5)}),
    defineField({name: 'tags', type: 'array', group: 'meta', of: [{type: 'string'}], options: {layout: 'tags'}}),
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
