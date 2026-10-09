import {defineStudio, type InputProps} from './lib/plugins'
import {StatsTool} from './plugins/stats'

// This studio's plugins (J65), one of each extension point, the same as the
// reference Studio's (reference/sanity/plugin.tsx). Shapes: lib/plugins.ts.

// reference/preview-site in Barkpark mode (PREVIEW_SOURCE=barkpark); :3536 is its Sanity twin.
const PREVIEW_ORIGIN = import.meta.env.VITE_PREVIEW_ORIGIN || 'http://localhost:3537'

/** The default text input with a character count under it. */
function CountedInput(props: InputProps) {
  const n = typeof props.value === 'string' ? props.value.length : 0
  return (
    <div>
      {props.renderDefault()}
      <div className="field-note">{n} characters</div>
    </div>
  )
}

export default defineStudio({
  // Sanity's `title`. VITE_STUDIO_TITLE names one deployment ("Gyldendal Agency Studio").
  title: import.meta.env.VITE_STUDIO_TITLE || 'Barkpark Studio',
  tools: [{name: 'stats', title: 'Stats', component: StatsTool}],
  // VITE_STUDIO_TOOLS="structure,vision" shows only those tools, in that order (Agency's navbar).
  navbarTools: import.meta.env.VITE_STUDIO_TOOLS
    ? String(import.meta.env.VITE_STUDIO_TOOLS).split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined,
  presentation: {
    previewUrl: PREVIEW_ORIGIN,
    mainDocuments: [
      {route: '/posts/:slug', type: 'post', field: 'slug'},
      {route: '/authors/:id', type: 'author'},
    ],
    // Its own pages; Barkpark adds the pages of the documents that reference it.
    locations: (doc) => {
      const slug = typeof doc.slug === 'string' ? doc.slug : (doc.slug as {current?: string} | undefined)?.current
      if (doc._type === 'post') return slug ? [{title: String(doc.title ?? 'Untitled'), href: `/posts/${slug}`}, {title: 'All posts', href: '/'}] : []
      if (doc._type === 'author') return [{title: String(doc.name ?? 'Untitled'), href: `/authors/${doc._publishedId}`}]
    },
  },
  form: {inputs: {'post.excerpt': CountedInput}},
  // J18: the reference Studio's template (reference/sanity/sanity.config.ts).
  templates: [{id: 'post-by-alan', title: 'Post by Alan Turing', schemaType: 'post', value: {author: 'author-alan'}}],
  document: {
    actions: (type) =>
      type === 'post'
        ? [({doc, set}) => ({label: doc.featured ? 'Unmark featured' : 'Mark featured', onHandle: () => set('featured', !doc.featured)})]
        : [],
    badges: (type) => (type === 'post' ? [(doc) => (doc.featured ? {label: 'Featured', color: 'success', title: 'Shown first on the site'} : null)] : []),
    productionUrl: (doc) => {
      const slug = typeof doc.slug === 'string' ? doc.slug : (doc.slug as {current?: string} | undefined)?.current
      return doc._type === 'post' && slug ? `${PREVIEW_ORIGIN}/posts/${slug}` : undefined
    },
  },
})
