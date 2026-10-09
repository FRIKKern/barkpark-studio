import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {defaultDocumentNode} from './views'
import {structure} from './structure'
import {presentation} from './presentation'
import {pluginSurface} from './plugin'

export default defineConfig({
  name: 'default',
  title: 'barkpark-studio-reference',

  projectId: 'ecu57yeh',
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',

  plugins: [structureTool({structure, defaultDocumentNode}), presentation, visionTool(), pluginSurface()],

  schema: {
    types: schemaTypes,
    // J18: initial value templates. A second way to start a post, offered in every Create new.
    templates: (prev) => [
      ...prev,
      {id: 'post-by-alan', title: 'Post by Alan Turing', schemaType: 'post', value: {author: {_type: 'reference', _ref: 'author-alan'}}},
      // Parameterised: only offered where a structure passes the author (structure.ts).
      {
        id: 'post-by-author',
        title: 'Post by author',
        schemaType: 'post',
        parameters: [{name: 'authorId', type: 'string'}],
        value: ({authorId}: {authorId: string}) => ({author: {_type: 'reference', _ref: authorId}}),
      },
    ],
  },
})
