import {TagIcon} from '@sanity/icons/Tag'
import {defineField, defineType} from 'sanity'

export const category = defineType({
  name: 'category',
  title: 'Category',
  type: 'document',
  // A row with no media draws the type's icon (fixtures/barkpark-schema/category.json "icon": "tag").
  icon: TagIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'description', type: 'text', rows: 2}),
    defineField({name: 'featuredPost', type: 'reference', to: [{type: 'post'}]}),
  ],
  // J56: select + prepare — a referenced title, a formatted date, a fallback when empty.
  preview: {
    select: {title: 'title', featured: 'featuredPost.title', date: 'featuredPost.publishedAt'},
    prepare: ({title, featured, date}) => {
      const day = date && new Date(date).toISOString().slice(0, 10).split('-').reverse().join('.')
      const parts = [featured, day].filter(Boolean)
      return {title, subtitle: parts.length ? parts.join(' · ') : 'No featured post'}
    },
  },
})
