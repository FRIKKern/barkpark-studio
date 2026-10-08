import {useEffect, useState} from 'react'
import {
  definePlugin,
  useClient,
  useDocumentOperation,
  type DocumentActionComponent,
  type DocumentBadgeComponent,
  type TextInputProps,
} from 'sanity'

// J65, the plugin surface: one of each extension point Sanity offers a studio.
const PREVIEW_ORIGIN = process.env.SANITY_STUDIO_PREVIEW_ORIGIN || 'http://localhost:3536'

function ChartIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 25 25" fill="none" stroke="currentColor" strokeWidth={1.2}>
      <path d="M5.5 19.5h14M8 17V11M12.5 17V7M17 17v-4" />
    </svg>
  )
}

/** A custom tool: how many documents of each type, published and drafts. */
function StatsTool() {
  const client = useClient({apiVersion: '2025-02-19'})
  const [rows, setRows] = useState<{type: string; published: number; drafts: number}[] | null>(null)
  useEffect(() => {
    client
      .fetch<{_type: string; _id: string}[]>(`*[!(_id in path("_.**")) && !(_type match "sanity.*")]{_type, _id}`, {}, {perspective: 'raw'})
      .then((docs) => {
        const by = new Map<string, {type: string; published: number; drafts: number}>()
        for (const d of docs) {
          const row = by.get(d._type) ?? {type: d._type, published: 0, drafts: 0}
          if (d._id.startsWith('drafts.')) row.drafts++
          else row.published++
          by.set(d._type, row)
        }
        setRows([...by.values()].sort((a, b) => a.type.localeCompare(b.type)))
      })
  }, [client])
  return (
    <div style={{padding: 24, fontFamily: 'inherit'}}>
      <h1 style={{fontSize: 20, margin: '0 0 16px'}}>Stats</h1>
      {!rows ? (
        <p>Loading…</p>
      ) : (
        <table style={{borderCollapse: 'collapse'}}>
          <thead>
            <tr>
              <th style={{textAlign: 'left', paddingRight: 24}}>Type</th>
              <th style={{textAlign: 'right', paddingRight: 24}}>Published</th>
              <th style={{textAlign: 'right'}}>Drafts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type}>
                <td style={{paddingRight: 24}}>{r.type}</td>
                <td style={{textAlign: 'right', paddingRight: 24}}>{r.published}</td>
                <td style={{textAlign: 'right'}}>{r.drafts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** A custom input: the default text input with a character count under it. */
export function CountedInput(props: TextInputProps) {
  const n = props.value?.length ?? 0
  return (
    <div>
      {props.renderDefault(props)}
      <div style={{fontSize: 12, opacity: 0.7, marginTop: 6}}>{n} characters</div>
    </div>
  )
}

/** A custom action, in the footer's menu: set or clear `featured` on the draft. */
const FeatureAction: DocumentActionComponent = ({id, type, draft, published, onComplete}) => {
  const {patch} = useDocumentOperation(id, type)
  const featured = Boolean((draft ?? published)?.featured)
  return {
    label: featured ? 'Unmark featured' : 'Mark featured',
    disabled: Boolean(patch.disabled),
    onHandle: () => {
      patch.execute([{set: {featured: !featured}}])
      onComplete()
    },
  }
}

/** A custom badge, beside the document's status: "Featured" while it is. */
const FeaturedBadge: DocumentBadgeComponent = ({draft, published}) =>
  (draft ?? published)?.featured ? {label: 'Featured', color: 'success', title: 'Shown first on the site'} : null

export const pluginSurface = definePlugin({
  name: 'plugin-surface',
  tools: [{name: 'stats', title: 'Stats', icon: ChartIcon, component: StatsTool}],
  document: {
    actions: (prev, {schemaType}) => (schemaType === 'post' ? [...prev, FeatureAction] : prev),
    badges: (prev, {schemaType}) => (schemaType === 'post' ? [...prev, FeaturedBadge] : prev),
    // "Open preview" in the document's menu.
    productionUrl: async (prev, {document}) => {
      const slug = (document as {slug?: {current?: string}}).slug?.current
      return document._type === 'post' && slug ? `${PREVIEW_ORIGIN}/posts/${slug}` : prev
    },
  },
})
