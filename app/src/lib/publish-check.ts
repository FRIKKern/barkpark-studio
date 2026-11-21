import type {Doc, Field, Schema} from './data'
import {fieldState, type FieldConditions, type Person} from './conditions.ts'
import {describeField, runCustomRules, type CustomRule} from './custom-rules.ts'
import {advisoryProblems, type Finding} from './findings.ts'
import {errorsOf, formOrder, validate, type Problem, type RefTarget} from './validation.ts'
import type {WidthOf} from './image-min-width.ts'
import type {T} from './i18n'

// task-2c8c20f6f510647f: one verdict on a draft, asked by the document's own Publish (the
// footer, DocumentPane) and by Publish selected (lib/bulk-publish.ts) alike. The form's check
// for this person (a field shut to them is judged as #1365 made it), the studio's custom rules
// (a Promise awaited, as the footer's Publish awaits it) and Barkpark's findings on the last
// save. Only an error holds a Publish; a warning or an info never does (J13).

export type Conditions = Record<string, FieldConditions> | undefined
export type Ask = {target?: RefTarget; t?: T; widthOf?: WidthOf}

/** Whether a field is shut to this person here (hidden or read-only): validation's `Shut`. */
export function shutFor(schema: Schema, doc: Doc, who: Person, conditions: Conditions) {
  return (f: Field, at: {path: string; value: unknown; parent?: Record<string, unknown>}) => {
    const s = fieldState(schema.name, f, doc, who, conditions, at)
    return s.hidden || s.readOnly
  }
}

/** The form's own check of a document for this person: what the pane marks. */
export function formCheck(doc: Doc, schema: Schema, who: Person, conditions: Conditions, {target, t, widthOf}: Ask = {}): Problem[] {
  return validate(doc, schema, target, t, shutFor(schema, doc, who, conditions), widthOf)
}

/** The errors that hold this draft's Publish, in the form's order (the first is the one to name). */
export async function publishErrors(doc: Doc, schema: Schema, who: Person, conditions: Conditions, {rules = [], findings = [], ...ask}: Ask & {rules?: CustomRule[]; findings?: Finding[]} = {}): Promise<Problem[]> {
  const own = formCheck(doc, schema, who, conditions, ask)
  const {now, later} = rules.length ? runCustomRules(rules, doc, describeField(schema)) : {now: [], later: null}
  const known = [...own, ...now, ...(later ? await later : [])]
  const extra = findings.length ? advisoryProblems(findings, schema, known, ask.t ?? ((en) => en)) : []
  return errorsOf([...known, ...extra])
    .filter((p) => !p.parse)
    .map((p, i) => [p, i] as const)
    .sort(([a, i], [b, j]) => formOrder(schema, a.path, b.path) || i - j)
    .map(([p]) => p)
}

/** A held draft's reason: the error's field as the validation panel names it, then its message. */
export const heldReason = (p: Problem) => `${[...(p.parents ?? []), p.title].filter(Boolean).join(' / ')}: ${p.message}`
