import {createContext, useCallback, useContext, type AnchorHTMLAttributes} from 'react'
import {useNavigate, useRouter, type NavigateOptions} from '@tanstack/react-router'
import {parseScope, scopedPath} from '../lib/scope'
import type {ScopeRef} from '../router'
import {useInlineChanges, usePublishedPerspective, withPerspective} from '../lib/perspective'

/**
 * B02: a studio path as this page's URL spells it: with the page's scope in front
 * (/w/<ws>/p/<project>/d/<dataset>/…) when it has one. The router does this for its own
 * navigation; raw hrefs (an <a>, a copied URL) use this.
 */
export function useScopedHref() {
  const scope = (useRouter().options.context as {scope?: ScopeRef}).scope
  return (href: string) => (scope?.current && href.startsWith('/') && !parseScope(href).scope ? scopedPath(scope.current, href) : href)
}

/**
 * J61: where a pane href leads. Panes build `/structure/…` hrefs; Presentation's
 * document panel hosts the same panes and maps those hrefs onto its own URL.
 */
export const PaneHrefContext = createContext<(href: string) => string>((href) => href)
/** The panes are hosted in Presentation's panel (J61): a document offers "Open in Structure". */
export const InPresentationContext = createContext(false)

/** useNavigate for pane hrefs: `{href}` goes where this pane host says. */
export function usePaneNavigate() {
  const navigate = useNavigate()
  const map = useContext(PaneHrefContext)
  const published = usePublishedPerspective()
  const inline = useInlineChanges()
  return useCallback((options: NavigateOptions & {href?: string}) => navigate(options.href ? {...options, href: map(withPerspective(options.href, published, inline))} : options), [navigate, map, published, inline])
}

/** Out of the pane host, to /structure itself (Presentation's "Open in Structure"); the perspective goes along. */
export function useStructureNavigate() {
  const navigate = useNavigate()
  const published = usePublishedPerspective()
  const inline = useInlineChanges()
  return useCallback((href: string) => navigate({href: withPerspective(href, published, inline)}), [navigate, published, inline])
}

/** A real link (open in new tab works) that navigates client-side on a plain click. */
export function PaneLink({href: paneHref, ...rest}: AnchorHTMLAttributes<HTMLAnchorElement> & {href: string}) {
  const navigate = useNavigate()
  const scoped = useScopedHref()
  const href = useContext(PaneHrefContext)(withPerspective(paneHref, usePublishedPerspective(), useInlineChanges()))
  return (
    <a
      href={scoped(href)}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        // Keyboard: Enter on a desk row re-draws its pane, and the row the focus was on went
        // with it (focus fell to the page). The same row in the new pane takes it back.
        const link = e.currentTarget
        const had = document.activeElement === link
        void navigate({href}).then(() =>
          requestAnimationFrame(() => {
            if (!had || link.isConnected) return
            const again = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((a) => a.getAttribute('href') === link.getAttribute('href'))
            if (again && (document.activeElement === document.body || !document.activeElement)) again.focus()
          }),
        )
      }}
      {...rest}
    />
  )
}
