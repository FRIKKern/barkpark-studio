import type {StructureResolver} from 'sanity/structure'

// J18: Sanity's default structure, plus one custom item: "Posts by author" lists the
// authors; an author opens their posts, and that list's "+" starts a post from the
// parameterised template `post-by-author` with this author. B13: the siteSettings
// singleton under a "Settings" divider, opened straight to its one document (Sanity's
// singleton recipe), where Barkpark's default desk puts it. Its doc is the one in
// fixtures/barkpark-only.ndjson; a dataset without it opens it empty (made on first edit).
export const SINGLETONS = ['siteSettings']
export const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .showIcons(false) // as the default structure looks
    .items([
      ...S.documentTypeListItems().filter((item) => !SINGLETONS.includes(item.getId() ?? '')),
      S.divider().title('Settings'),
      S.listItem()
        .id('siteSettings')
        .title('Site settings')
        .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
      S.divider(),
      S.listItem()
        .id('posts-by-author')
        .title('Posts by author')
        .child(
          S.documentTypeList('author')
            .title('Authors')
            .child((authorId) =>
              S.documentList()
                .title('Posts')
                .schemaType('post')
                .filter('_type == "post" && author._ref == $authorId')
                .params({authorId})
                .initialValueTemplates([S.initialValueTemplateItem('post-by-author', {authorId})]),
            ),
        ),
      // A nested list (S.list() under an S.listItem()): two filtered post lists, a titled
      // divider and a type list. Its rows show icons (Sanity's FolderIcon, none being named).
      S.divider(),
      S.listItem()
        .id('editorial')
        .title('Editorial')
        .child(
          S.list()
            .id('editorial')
            .title('Editorial')
            .items([
              S.listItem().id('featured-posts').title('Featured posts').child(S.documentTypeList('post').id('featured-posts').title('Featured posts').filter('_type == "post" && featured == true')),
              S.listItem().id('top-rated').title('Top rated').child(S.documentTypeList('post').id('top-rated').title('Top rated').filter('_type == "post" && rating >= $min').params({min: 4})),
              S.divider().title('Taxonomy'),
              S.documentTypeListItem('category'),
            ]),
        ),
    ])
