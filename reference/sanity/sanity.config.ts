import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {defaultDocumentNode} from './views'
import {presentation} from './presentation'

export default defineConfig({
  name: 'default',
  title: 'barkpark-studio-reference',

  projectId: 'ecu57yeh',
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',

  plugins: [structureTool({defaultDocumentNode}), presentation, visionTool()],

  schema: {
    types: schemaTypes,
  },
})
