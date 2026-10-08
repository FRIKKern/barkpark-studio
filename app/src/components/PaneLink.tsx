import type {AnchorHTMLAttributes} from 'react'
import {useNavigate, useRouter} from '@tanstack/react-router'
import {parseScope, scopedPath} from '../lib/scope'
import type {ScopeRef} from '../router'

/**
 * B02: a studio path as this page's URL spells it: with the page's scope in front
 * (/w/<ws>/p/<project>/d/<dataset>/…) when it has one. The router does this for its own
 * navigation; raw hrefs (an <a>, a copied URL) use this.
 */
export function useScopedHref() {
  const scope = (useRouter().options.context as {scope?: ScopeRef}).scope
  return (href: string) => (scope?.current && href.startsWith('/') && !parseScope(href).scope ? scopedPath(scope.current, href) : href)
}

/** A real link (open in new tab works) that navigates client-side on a plain click. */
export function PaneLink({href, ...rest}: AnchorHTMLAttributes<HTMLAnchorElement> & {href: string}) {
  const navigate = useNavigate()
  const scoped = useScopedHref()
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
