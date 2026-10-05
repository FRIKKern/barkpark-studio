import type {QueryClient} from '@tanstack/react-query'
import {Navbar} from '../components/Navbar'
import {Structure} from '../components/Structure'
import {docQuery, fetchViewportHint, listQuery, schemaOf, schemasQuery, type Doc, type Schema} from './data'
import {parsePanes, type Pane} from './panes'

// Everything a pane chain needs before it paints: schemas, the list, every open
// doc, and the docs their previews follow (refs + preview subtitles). On a
// reload this runs on the server, so the whole chain arrives in the HTML.
export async function loadPanes(queryClient: QueryClient, splat: string | undefined) {
  const panes = parsePanes(splat)
  const [schemas, widthHint] = await Promise.all([queryClient.ensureQueryData(schemasQuery), fetchViewportHint()])
  const lists = panes.flatMap((p) => (p.kind === 'list' ? [queryClient.ensureQueryData(listQuery(p.type))] : []))
  const docs = panes.flatMap((p) => (p.kind === 'doc' ? [ensureDoc(queryClient, schemas, p.type, p.id, 2)] : []))
  const listed = await Promise.all(lists)
  await Promise.all([...docs, ...listed.flat().map((d) => ensureDeps(queryClient, schemas, d, 0))])
  return {panes, widthHint}
}

async function ensureDoc(qc: QueryClient, schemas: Schema[], type: string, id: string, depth: number) {
  const doc = await qc.ensureQueryData(docQuery(type, id))
  if (doc) await ensureDeps(qc, schemas, doc, depth)
}

/** depth 0: just what the doc's own preview needs; deeper: also its reference fields. */
async function ensureDeps(qc: QueryClient, schemas: Schema[], doc: Doc, depth: number) {
  const schema = schemaOf(schemas, doc._type)
  if (!schema) return
  const wanted: Promise<unknown>[] = []
  const sub = schema.listPreview?.subtitle
  if (sub?.includes('.')) {
    const f = schema.fields.find((x) => x.name === sub.split('.')[0])
    const id = f && (doc[f.name] as string)
    if (f?.refType && id) wanted.push(qc.ensureQueryData(docQuery(f.refType, id)))
  }
  if (depth > 0)
    for (const f of schema.fields) {
      const ids = f.type === 'reference' ? [doc[f.name]] : f.type === 'arrayOf' && f.of?.type === 'reference' ? ((doc[f.name] as unknown[]) ?? []) : []
      const refType = f.refType ?? f.of?.refType
      for (const id of ids) if (typeof id === 'string' && refType) wanted.push(ensureDoc(qc, schemas, refType, id, depth - 1))
    }
  await Promise.all(wanted)
}

export function StructureView({panes, widthHint}: {panes: Pane[]; widthHint: number}) {
  return (
    <>
      <Navbar />
      <Structure panes={panes} widthHint={widthHint} />
    </>
  )
}
