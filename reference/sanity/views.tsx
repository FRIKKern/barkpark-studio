import type {DefaultDocumentNodeResolver} from 'sanity/structure'

// A second document view (J26): with more than one view, Sanity's document pane
// offers "Split pane right". The view itself is the document's JSON, read-only.
function JsonView({document}: {document: {displayed: unknown}}) {
  return <pre style={{margin: 0, padding: 16, fontSize: 13}}>{JSON.stringify(document.displayed, null, 2)}</pre>
}

export const defaultDocumentNode: DefaultDocumentNodeResolver = (S) =>
  S.document().views([S.view.form(), S.view.component(JsonView).title('JSON')])
