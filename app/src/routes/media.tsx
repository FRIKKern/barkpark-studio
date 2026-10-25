import {createFileRoute} from '@tanstack/react-router'
import {requireEditor} from '../lib/structure-route'
import {Navbar} from '../components/Navbar'
import {localeQuery, translate} from '../lib/i18n'
import {MediaLibrary, type MediaSearch} from '../components/MediaLibrary'
import {KINDS, SORTS, type Kind, type Sort} from '../lib/media-library'
import {studioName} from '../lib/studio-name'

// B08: the media library as its own tool, beside Structure and Vision.
// Its kind or folder, search, visibility, sort and view live in the URL, so Back, a reload and a
// shared link bring them back (as Vision keeps its query). Defaults leave the URL bare.
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
export const Route = createFileRoute('/media')({
  validateSearch: (s: Record<string, unknown>): MediaSearch => ({
    kind: KINDS.includes(s.kind as Kind) ? (s.kind as Kind) : undefined,
    folder: text(s.folder),
    q: text(s.q),
    visibility: s.visibility === 'public' || s.visibility === 'private' ? s.visibility : undefined,
    sort: SORTS.includes(s.sort as Sort) && s.sort !== SORTS[0] ? (s.sort as Sort) : undefined,
    view: s.view === 'list' ? 'list' : undefined,
  }),
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  head: ({match}) => ({meta: [{title: `${translate(match.context.queryClient.getQueryData(localeQuery.queryKey)?.locale ?? 'en', 'Media')} · ${studioName}`}]}),
  component: MediaPage,
})

function MediaPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  // A change replaces the entry: Back leaves Media, as before, instead of undoing a filter.
  const onSearch = (patch: Partial<MediaSearch>) => void navigate({search: (prev) => ({...prev, ...patch}), replace: true})
  return (
    <>
      <Navbar />
      <MediaLibrary search={search} onSearch={onSearch} />
    </>
  )
}
