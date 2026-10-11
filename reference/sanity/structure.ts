import type {StructureResolver} from 'sanity/structure'

// J18: Sanity's default structure, plus one custom item: "Posts by author" lists the
// authors; an author opens their posts, and that list's "+" starts a post from the
// parameterised template `post-by-author` with this author.
export const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .showIcons(false) // as the default structure looks
    .items([
      ...S.documentTypeListItems(),
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
    ])
