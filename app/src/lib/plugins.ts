import type {DeskNode} from './desk'
import type {ComponentType, ReactNode} from 'react'
import type {Doc, Field} from './data'

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
  /** The navbar's and drawer's tools by name (`structure`, `vision`, a plugin tool's name), in order. Unset: all of them. */
  navbarTools?: string[]
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

export const defineStudio = (config: StudioConfig) => config

/** The navbar's name and logo initials ("GA" for "Gyldendal Agency Studio"), as Sanity derives them. */
export function studioBrand(title: string | undefined) {
  const name = title?.trim() || 'Barkpark Studio'
  const initials = name.split(/\s+/).filter((w) => !/^studio$/i.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'B'
  return {name, initials: name === 'Barkpark Studio' ? 'B' : initials}
}
