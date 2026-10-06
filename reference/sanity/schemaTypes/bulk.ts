import {defineField, defineType} from 'sanity'

// J41's big list: 5,000 docs (scripts/seed-bulk.mjs). Same shape as
// fixtures/barkpark-schema/bulk.json.
export const bulk = defineType({
  name: 'bulk',
  title: 'Bulk',
  type: 'document',
  fields: [defineField({name: 'title', type: 'string'})],
})
