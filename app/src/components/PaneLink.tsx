import type {AnchorHTMLAttributes} from 'react'
import {useNavigate} from '@tanstack/react-router'

/** A real link (open in new tab works) that navigates client-side on a plain click. */
export function PaneLink({href, ...rest}: AnchorHTMLAttributes<HTMLAnchorElement> & {href: string}) {
  const navigate = useNavigate()
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate({href})
      }}
      {...rest}
    />
  )
}
