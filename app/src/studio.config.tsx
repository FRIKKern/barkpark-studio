import {defineStudio, type InputProps} from './lib/plugins'
import {StatsTool} from './plugins/stats'

// This studio's plugins (J65), one of each extension point, the same as the
// reference Studio's (reference/sanity/plugin.tsx). Shapes: lib/plugins.ts.

const PREVIEW_ORIGIN = import.meta.env.VITE_PREVIEW_ORIGIN || 'http://localhost:3536'

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
  tools: [{name: 'stats', title: 'Stats', component: StatsTool}],
  form: {inputs: {'post.excerpt': CountedInput}},
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
