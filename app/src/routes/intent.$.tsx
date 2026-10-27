import {useEffect, useState} from 'react'
import {createFileRoute, Link, useNavigate} from '@tanstack/react-router'
import {useQueryClient} from '@tanstack/react-query'
import {requireEditor} from '../lib/structure-route'
import {anyDocQuery, schemaOf, schemasQuery} from '../lib/data'
import {parseIntent} from '../lib/intent'
import {choiceById, choicesFor, startNew} from '../lib/templates'
import {panesPath} from '../lib/panes'
import {focusFirstField} from '../lib/focus'
import {Navbar} from '../components/Navbar'
import {useT} from '../lib/i18n'

// Sanity's intent links open here as they do in Sanity: edit → the document in its type's
// list; create → a new document of the type (from the template, with its parameters).
export const Route = createFileRoute('/intent/$')({
  beforeLoad: ({context, location}) => requireEditor(context.queryClient, location.href),
  component: IntentPage,
})

function IntentPage() {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const splat = Route.useParams()._splat ?? ''
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    const intent = parseIntent(splat)
    if (!intent) return setFailed(t('This link is not one the Studio knows.'))
    let gone = false
    void (async () => {
      const schemas = await qc.fetchQuery(schemasQuery)
      if (intent.action === 'edit') {
        const type = intent.type ?? (await qc.fetchQuery(anyDocQuery(intent.id)))?._type
        if (gone) return
        if (!type || !schemaOf(schemas, type)) return setFailed(t('A document with the {id} identifier could not be found.', {id: intent.id}))
        // A site's click-to-edit link names the field too: the pane opens on it (its J52 `path`).
        return void navigate({href: panesPath([{kind: 'types'}, {kind: 'list', type}, {kind: 'doc', id: intent.id, type, ...(intent.path ? {path: intent.path} : {})}]), replace: true})
      }
      // The link's template, checked as user input (lib/template-resolve): one for its type only.
      const choice = intent.template ? choiceById(schemas, intent.type, intent.template, intent.params) : choicesFor(schemas, intent.type)[0]
      if (gone) return
      if (!choice || !schemaOf(schemas, choice.type)) return setFailed(t('This link is not one the Studio knows.'))
      const id = intent.id ?? crypto.randomUUID()
      await startNew(qc, schemas, choice, id)
      if (gone) return
      void navigate({href: panesPath([{kind: 'types'}, {kind: 'list', type: choice.type}, {kind: 'doc', id, type: choice.type}]), replace: true})
      focusFirstField(id)
    })().catch((e) => !gone && setFailed((e as Error).message))
    return () => void (gone = true)
  }, [splat])
  return (
    <>
      <Navbar />
      <main className="tool-page">
        {failed ? (
          <>
            <p role="alert">{failed}</p>
            <Link to="/structure">{t('Go to Structure')}</Link>
          </>
        ) : (
          <p className="muted" role="status">
            {t('Opening…')}
          </p>
        )}
      </main>
    </>
  )
}
