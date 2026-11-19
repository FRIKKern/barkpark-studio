import type {DeskNode} from './desk'
import type {ComponentType, ReactNode} from 'react'
import type {Doc, Field} from './data'
import type {CustomRule} from './custom-rules'
import type {IncomingInput} from './incoming-refs'
import type {DashboardConfig} from './dashboard'
import type {FieldConditions} from './conditions'

// J65, the plugin surface, after Sanity's: a studio config names extra tools,
// custom field inputs, document actions, document badges and a preview URL.
// The config itself is app/src/studio.config.tsx; this file is its shape.

/** A navbar tool: `/name` opens `component` under the navbar. */
export type Tool = {name: string; title: string; component: ComponentType}

/** A custom input gets what the default one gets, and can render the default. */
export type InputProps = {field: Field; path: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; renderDefault: () => ReactNode}

/** An action in the footer's "…" menu. `set` edits the draft, like typing in a field. */
export type DocumentAction = (ctx: {doc: Doc; set: (field: string, value: unknown) => void}) => {label: string; onHandle: () => void; disabled?: boolean} | null

/** A badge beside the save state, Sanity's colors. */
export type DocumentBadge = (doc: Doc) => {label: string; color?: 'primary' | 'success' | 'warning' | 'danger'; title?: string} | null

export type StudioConfig = {
  /** The studio's name in the navbar, Sanity's `title` ("Gyldendal Agency Studio"); its initials are the logo. */
  title?: string
  tools?: Tool[]
  /** The navbar's and drawer's tools by name (`structure`, `dashboard`, `vision`, a plugin tool's name), in order. Unset: all of them. */
  navbarTools?: string[]
  /**
   * The Dashboard tool (Sanity's @sanity/dashboard), on when this is set: `widgets` in a grid, each
   * one of the studio's own (`{type: 'drafts' | 'recent' | 'tasks' | 'scheduled' | 'members' |
   * 'projectInfo'}`), Sanity's document list (`{type: 'documentList', title, types, order, limit,
   * createNew}`) or a component of yours (`{name, component, layout: {width}}`). No `widgets`: the
   * default five (lib/dashboard.ts).
   */
  dashboard?: DashboardConfig
  /** J58: the Presentation tool, over the site at `previewUrl`; J61: its routes' main documents. */
  presentation?: {
    previewUrl: string
    mainDocuments?: MainDocument[]
    /** J62: a document's own pages (paths on the site). `undefined`: the type has no pages, no banner. */
    locations?: (doc: Doc) => {title: string; href: string}[] | undefined
  }
  form?: {
    /** Keyed `type.path` (`post.excerpt`). */
    inputs?: Record<string, ComponentType<InputProps>>
    /**
     * Sanity's `hidden` and `readOnly` callbacks, keyed `type.path` (`post.stage`; a field in an
     * array's items leaves the item out, `post.links.title`): `({currentUser, document, parent,
     * value, path}) => boolean`, `currentUser.roles` under Sanity's role names
     * (lib/conditions.ts). Added to the schema's own; a form convenience, not access control.
     */
    conditions?: Record<string, FieldConditions>
    /**
     * Every custom role `conditions` name (`['reviewer']`): a paste lock compares administrator,
     * editor, contributor, viewer, the person's own role and these (lib/conditions.ts roleHidden).
     * A custom role not listed is not compared.
     */
    roles?: string[]
    /**
     * Sanity's defineIncomingReferenceDecoration, keyed by type: lists, in that type's form, of
     * the documents that reference the open one, with "Add item" (lib/incoming-refs.ts). A
     * schema declares the same as `desk.incoming`; a name the schema has taken wins.
     */
    incomingReferences?: Record<string, IncomingInput[]>
  }
  /** J18: Sanity's initial value templates: more ways to start a type, offered in every Create new. */
  templates?: Template[]
  /** J18: Sanity's custom structure items, after the type list (or the declared desk) and a divider. */
  structure?: {items: DeskNode[]}
  document?: {
    actions?: (type: string) => DocumentAction[]
    badges?: (type: string) => DocumentBadge[]
    /** "Open preview" in the document's "…" menu (Ctrl+Alt+O) when this returns a URL. */
    productionUrl?: (doc: Doc) => string | undefined
    /**
     * Sanity's Rule.custom: rules on a field (`path`) or the whole document, with `document` and
     * `parent` in their context, answering at once or with a Promise (10 s at most). Studio only,
     * as Sanity's custom rules: API writes and imports are not checked by them.
     */
    validation?: (type: string) => CustomRule[]
  }
}

/**
 * A second way to start `schemaType` (Sanity's template): its title in Create new, its
 * starting values. With `parameters` it is offered only where a structure item passes
 * them (a desk node's `child.template`), and `value` is a function of them.
 */
export type Template = {id: string; title: string; schemaType: string} & (
  | {parameters?: undefined; value: Record<string, unknown>}
  | {parameters: string[]; value: (params: Record<string, string>) => Record<string, unknown>}
)

/** A site route's main document: `/posts/:slug` with `field: 'slug'`, or `/authors/:id` (the id). */
export type MainDocument = {route: string; type: string; field?: string}

/** The studio config, checked as it loads: a bad `form.roles` is a config error. */
export function defineStudio(config: StudioConfig) {
  const roles: unknown = config.form?.roles
  if (roles !== undefined && !(Array.isArray(roles) && roles.every((r) => typeof r === 'string' && r.trim() !== '')))
    throw new Error(`studio config: form.roles must be an array of role names (non-empty strings), not ${JSON.stringify(roles)}`)
  return config
}

/** The navbar's name and logo initials ("GA" for "Gyldendal Agency Studio"), as Sanity derives them. */
export function studioBrand(title: string | undefined) {
  const name = title?.trim() || 'Barkpark Studio'
  const initials = name.split(/\s+/).filter((w) => !/^studio$/i.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'B'
  return {name, initials: name === 'Barkpark Studio' ? 'B' : initials}
}
