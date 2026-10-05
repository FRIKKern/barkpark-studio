import {defineField, defineType} from 'sanity'

export const author = defineType({
  name: 'author',
  title: 'Author',
  type: 'document',
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'name'}}),
    defineField({name: 'image', type: 'image', options: {hotspot: true}}),
    defineField({name: 'bio', type: 'text', rows: 4}),
    // Closes the reference loop post → author → category → post for J21 (endless pane chain).
    defineField({name: 'expertise', type: 'reference', to: [{type: 'category'}]}),
  ],
  preview: {select: {title: 'name', media: 'image'}},
})
