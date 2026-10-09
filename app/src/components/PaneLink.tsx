import {createContext, useCallback, useContext, type AnchorHTMLAttributes} from 'react'
import {useNavigate, useRouter, type NavigateOptions} from '@tanstack/react-router'
import {parseScope, scopedPath} from '../lib/scope'
import type {ScopeRef} from '../router'
import {usePublishedPerspective, withPerspective} from '../lib/perspective'

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

/** useNavigate for pane hrefs: `{href}` goes where this pane host says. */
export function usePaneNavigate() {
  const navigate = useNavigate()
  const map = useContext(PaneHrefContext)
  const published = usePublishedPerspective()
  return useCallback((options: NavigateOptions & {href?: string}) => navigate(options.href ? {...options, href: map(withPerspective(options.href, published))} : options), [navigate, map, published])
}

/** A real link (open in new tab works) that navigates client-side on a plain click. */
export function PaneLink({href: paneHref, ...rest}: AnchorHTMLAttributes<HTMLAnchorElement> & {href: string}) {
  const navigate = useNavigate()
  const scoped = useScopedHref()
  const href = useContext(PaneHrefContext)(withPerspective(paneHref, usePublishedPerspective()))
  return (
    <a
      href={scoped(href)}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate({href})
      }}
      {...rest}
    />
  )
}
