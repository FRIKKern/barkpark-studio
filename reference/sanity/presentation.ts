import {map} from 'rxjs'
import {defineDocuments, presentationTool} from 'sanity/presentation'

// J58–J64 bar: Presentation over the tiny site in reference/preview-site.
const PREVIEW_ORIGIN = process.env.SANITY_STUDIO_PREVIEW_ORIGIN || 'http://localhost:3536'

export const presentation = presentationTool({
  previewUrl: {
    origin: PREVIEW_ORIGIN,
    previewMode: {enable: '/api/draft-mode/enable', disable: '/api/draft-mode/disable'},
  },
  resolve: {
    mainDocuments: defineDocuments([
      {route: '/posts/:slug', filter: `_type == "post" && slug.current == $slug`},
      {route: '/authors/:id', filter: `_type == "author" && _id == $id`},
    ]),
    // J62: a document's own pages, then the pages of the posts that reference it — the
    // same answer Barkpark's GET …/locations gives (referrers with a desk.preview).
    locations: (params, {documentStore}) => {
      if (params.type !== 'post' && params.type !== 'author') return null
      const id = params.id.replace(/^drafts\./, '')
      const query = `{
        "doc": *[_id in [$id, "drafts." + $id]] | order(_updatedAt desc)[0]{_type, title, name, "slug": slug.current},
        "referrers": *[_type == "post" && references($id) && defined(slug.current)] | order(title asc){title, "slug": slug.current}
      }`
      type Row = {_type?: string; title?: string; name?: string; slug?: string}
      return documentStore.listenQuery(query, {id}, {perspective: 'drafts'}).pipe(
        map((res: {doc: Row | null; referrers: Row[]}) => {
          const own = !res.doc
            ? []
            : res.doc._type === 'post'
              ? res.doc.slug
                ? [{title: res.doc.title || 'Untitled', href: `/posts/${res.doc.slug}`}, {title: 'All posts', href: '/'}]
                : []
              : [{title: res.doc.name || 'Untitled', href: `/authors/${id}`}]
          const all = [...own, ...res.referrers.map((r) => ({title: r.title || 'Untitled', href: `/posts/${r.slug}`}))]
          return {locations: all.filter((l, i) => all.findIndex((x) => x.href === l.href) === i)}
        }),
      )
    },
  },
})
