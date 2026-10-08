import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {defaultDocumentNode} from './views'

export default defineConfig({
  name: 'default',
  title: 'barkpark-studio-reference',

  projectId: 'ecu57yeh',
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',

  plugins: [structureTool({defaultDocumentNode}), visionTool()],

  schema: {
    types: schemaTypes,
  },
})
