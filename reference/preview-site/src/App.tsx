import {useLiveMode, type QueryResponseInitial} from '@sanity/react-loader'
import {VisualEditing} from '@sanity/visual-editing/react'
import {Link, historyAdapter, usePathname} from './router'
import {draftMode, liveClient, useLiveData, useLoad} from './sanity'
import {BarkparkPage, SharedBanner, SOURCE} from './barkpark-source'
import type {Edit} from './bp-pages'
import {EditOverlays} from './overlays'

// The reference preview site for J58–J64: three routes. From Sanity every text is a
// stega string; from Barkpark (PREVIEW_SOURCE=barkpark) the same pages, same markup.
type PostRow = {
  _id: string
  title?: string
  slug?: string
  excerpt?: string
  author?: {_id: string; name?: string}
  /** Barkpark mode (J59): a value's click-to-edit attributes; Sanity mode uses stega instead. */
  $edit?: Edit
  $editAuthor?: Edit
}
type Post = PostRow & {
  categories?: {_id: string; title?: string}[]
  body?: {_key: string; _type: string; children?: {_key: string; text?: string}[]}[]
  related?: {_type: string; _id: string; title?: string; name?: string; slug?: string}
}
type Author = {_id: string; name?: string; bio?: string; posts: PostRow[]; $edit?: Edit}

const ROW = `_id, title, "slug": slug.current, excerpt, author->{_id, name}`
const HOME = `*[_type == "post" && defined(slug.current)] | order(title asc) {${ROW}}`
const POST = `*[_type == "post" && slug.current == $slug][0] {
  ${ROW}, categories[]->{_id, title}, body, related->{_type, _id, title, name, "slug": slug.current}
}`
const AUTHOR = `*[_type == "author" && _id == $id][0] {
  _id, name, bio, "posts": *[_type == "post" && references(^._id) && defined(slug.current)] | order(title asc) {${ROW}}
}`

export type PageKey = {kind: 'home'} | {kind: 'post'; slug: string} | {kind: 'author'; id: string}
const QUERIES = {home: HOME, post: POST, author: AUTHOR}

/** A page's data from Sanity (GROQ, live in Sanity's Presentation) or Barkpark (PREVIEW_SOURCE=barkpark). */
function Loaded<T>({page, render}: {page: PageKey; render: (data: T) => React.ReactNode}) {
  if (SOURCE === 'barkpark') return <BarkparkPage<T> page={page} render={render} />
  const params: Record<string, string> = page.kind === 'post' ? {slug: page.slug} : page.kind === 'author' ? {id: page.id} : {}
  return <SanityLoaded<T> query={QUERIES[page.kind]} params={params} render={render} />
}

function SanityLoaded<T>({query, params = {}, render}: {query: string; params?: Record<string, string>; render: (data: T) => React.ReactNode}) {
  const {initial, error} = useLoad<T>(query, params)
  if (error) return <p role="alert">Could not load: {error}</p>
  if (!initial) return <p className="meta">Loading…</p>
  return <Live query={query} params={params} initial={initial} render={render} />
}

function Live<T>({query, params, initial, render}: {query: string; params: Record<string, string>; initial: QueryResponseInitial<T>; render: (data: T) => React.ReactNode}) {
  return <>{render(useLiveData<T>(query, params, initial))}</>
}

function PostList({posts}: {posts: PostRow[]}) {
  return (
    <ul className="posts">
      {posts.map((p) => (
        <li key={p._id}>
          <Link to={`/posts/${p.slug}`}><span {...p.$edit?.('title')}>{p.title}</span></Link>
          {p.author && <div className="meta">by <span {...p.$editAuthor?.('name')}>{p.author.name}</span></div>}
        </li>
      ))}
    </ul>
  )
}

function Page() {
  const path = usePathname()
  const post = /^\/posts\/([^/]+)$/.exec(path)
  const author = /^\/authors\/([^/]+)$/.exec(path)
  if (path === '/')
    return <Loaded<PostRow[]> page={{kind: 'home'}} render={(posts) => (<><h1>Posts</h1><PostList posts={posts} /></>)} />
  if (post)
    return (
      <Loaded<Post | null>
        page={{kind: 'post', slug: decodeURIComponent(post[1])}}
        render={(p) =>
          !p ? <h1>Not found</h1> : (
            <article>
              <h1 {...p.$edit?.('title')}>{p.title}</h1>
              {p.author && <p className="meta">by <Link to={`/authors/${p.author._id}`}><span {...p.$editAuthor?.('name')}>{p.author.name}</span></Link></p>}
              {p.excerpt && <p><em {...p.$edit?.('excerpt')}>{p.excerpt}</em></p>}
              <p>{p.categories?.map((c) => <span className="chip" key={c._id}>{c.title}</span>)}</p>
              {p.body?.filter((b) => b._type === 'block').map((b) => <p key={b._key} {...p.$edit?.('body')}>{b.children?.map((c) => c.text).join('')}</p>)}
              {p.related && (
                <p className="meta">
                  Related:{' '}
                  <Link to={p.related._type === 'post' ? `/posts/${p.related.slug}` : `/authors/${p.related._id}`}>{p.related.title ?? p.related.name}</Link>
                </p>
              )}
            </article>
          )
        }
      />
    )
  if (author)
    return (
      <Loaded<Author | null>
        page={{kind: 'author', id: decodeURIComponent(author[1])}}
        render={(a) => (!a ? <h1>Not found</h1> : (<><h1 {...a.$edit?.('name')}>{a.name}</h1>{a.bio && <p {...a.$edit?.('bio')}>{a.bio}</p>}<h2>Posts</h2><PostList posts={a.posts} /></>))}
      />
    )
  return <h1>Not found</h1>
}

function LiveMode() {
  useLiveMode({client: liveClient})
  return <VisualEditing history={historyAdapter} portal />
}

export function App() {
  return (
    <>
      {SOURCE === 'sanity' && draftMode && (
        <div className="banner">
          Draft mode · <a href="/api/draft-mode/disable">Leave</a>
        </div>
      )}
      {SOURCE === 'barkpark' && <SharedBanner />}
      <header>
        <Link to="/">Reference site</Link>
      </header>
      <main>
        <Page />
      </main>
      {SOURCE === 'sanity' && draftMode && <LiveMode />}
      {SOURCE === 'barkpark' && window.parent !== window && <EditOverlays />}
    </>
  )
}
