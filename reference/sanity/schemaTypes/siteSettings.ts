import {defineField, defineType} from 'sanity'

// A singleton, Barkpark's siteSettings (fixtures/barkpark-schema/siteSettings.json): one
// document, opened straight from the desk (structure.ts), never listed or created.
export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  fields: [
    defineField({name: 'title', title: 'Site title', type: 'string'}),
    defineField({name: 'tagline', title: 'Tagline', type: 'string'}),
  ],
})
