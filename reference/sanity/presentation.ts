import {defineDocuments, defineLocations, presentationTool} from 'sanity/presentation'

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
    locations: {
      post: defineLocations({
        select: {title: 'title', slug: 'slug.current'},
        resolve: (doc) => ({
          locations: doc?.slug
            ? [{title: doc.title || 'Untitled', href: `/posts/${doc.slug}`}, {title: 'All posts', href: '/'}]
            : [],
        }),
      }),
      author: defineLocations({
        select: {name: 'name', id: '_id'},
        resolve: (doc) => ({
          locations: doc?.id ? [{title: doc.name || 'Untitled', href: `/authors/${doc.id.replace(/^drafts\./, '')}`}] : [],
        }),
      }),
    },
  },
})
