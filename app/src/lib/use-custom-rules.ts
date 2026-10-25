import {useEffect, useMemo, useRef, useState} from 'react'
import studio from '../studio.config'
import type {Doc, Field, Schema} from './data'
import type {Problem} from './validation'
import {latestOnly, runCustomRules} from './custom-rules'
import {useT} from './i18n'

// The studio config's custom rules (StudioConfig.document.validation) on the document as
// edited: run a moment after the typing settles, their answers (at once or later) shown with
// the schema's own, `validating` while any is still out. Studio only, as Sanity's custom rules:
// an API write is not checked by them (lib/custom-rules.ts).
const SETTLE_MS = 300

const fieldTitle = (schema: Schema | undefined, path: string) => {
  let fields: Field[] | undefined = schema?.fields
  let title = schema?.title ?? ''
  for (const name of path.split('.').filter(Boolean)) {
    const f = fields?.find((x) => x.name === name)
    if (!f) return name
    title = f.title ?? f.name
    fields = (f as {fields?: Field[]}).fields
  }
  return title
}
const valuesKey = (doc: Doc) => JSON.stringify(doc, (k, v) => (k === '_rev' || k === '_updatedAt' ? undefined : v))

export function useCustomRules(doc: Doc | null | undefined, schema: Schema | undefined, enabled: boolean): {problems: Problem[]; validating: boolean; check: () => Promise<Problem[]>} {
  const t = useT()
  const type = doc?._type
  const rules = useMemo(() => (enabled && type ? (studio.document?.validation?.(type) ?? []) : []), [enabled, type])
  const key = rules.length && doc ? valuesKey(doc) : ''
  const [settled, setSettled] = useState(key)
  useEffect(() => {
    const id = setTimeout(() => setSettled(key), SETTLE_MS)
    return () => clearTimeout(id)
  }, [key])
  const [state, setState] = useState<{key: string; now: Problem[]; later: Problem[]; pending: boolean}>({key: '', now: [], later: [], pending: false})
  const runs = useRef(latestOnly())
  const latestDoc = useRef(doc)
  latestDoc.current = doc
  useEffect(() => {
    const d = latestDoc.current
    if (!rules.length || !d || !settled) return void setState({key: settled, now: [], later: [], pending: false})
    const run = runs.current.next()
    const {now, later} = runCustomRules(rules, d, (path) => fieldTitle(schema, path))
    setState({key: settled, now, later: [], pending: !!later})
    // An answer for values since edited is dropped (a newer run is out).
    later?.then((ps) => runs.current.current(run) && setState((s) => ({...s, later: ps, pending: false})))
  }, [settled, rules, schema])
  // Publish asks now, on the document as it is, and waits for any Promise (Sanity's publish waits
  // for validation too): the settled answers may be a few hundred ms behind the typing.
  const check = async (): Promise<Problem[]> => {
    const d = latestDoc.current
    if (!rules.length || !d) return []
    const run = runs.current.next()
    const k = valuesKey(d)
    const {now, later} = runCustomRules(rules, d, (path) => fieldTitle(schema, path))
    setState({key: k, now, later: [], pending: !!later})
    const after = later ? await later : []
    if (runs.current.current(run)) setState({key: k, now, later: after, pending: false})
    return [...now, ...after]
  }
  if (!rules.length) return {problems: [], validating: false, check}
  // A rule's own message is its author's; the studio's timeout is said in the studio's language.
  const problems = (state.key === key ? [...state.now, ...state.later] : [...state.now]).map((p) => (p.message === 'Validation timed out' ? {...p, message: t('Validation timed out')} : p))
  // Held only while a Promise is out: a sync rule's answer for the latest values comes at Publish (check).
  return {problems, validating: state.pending, check}
}
