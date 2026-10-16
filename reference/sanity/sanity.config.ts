import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {defaultDocumentNode} from './views'
import {SINGLETONS, structure} from './structure'
import {presentation} from './presentation'
import {pluginSurface} from './plugin'

const SINGLETON_ACTIONS = new Set(['publish', 'discardChanges', 'restore'])

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
      // B13: a singleton is never created (Sanity's singleton recipe; Barkpark's `singleton`).
      ...prev.filter((t) => !SINGLETONS.includes(t.schemaType)),
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

  // B13: a singleton keeps Publish, Discard changes and Restore (no duplicate, delete or unpublish).
  document: {
    actions: (prev, {schemaType}) => (SINGLETONS.includes(schemaType) ? prev.filter(({action}) => action && SINGLETON_ACTIONS.has(action)) : prev),
  },
})
