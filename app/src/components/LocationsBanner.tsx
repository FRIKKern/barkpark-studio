import {useEffect, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Link} from '@tanstack/react-router'
import type {Doc} from '../lib/data'
import {useT} from '../lib/i18n'
import {locationsQuery, type Location} from '../lib/locations'
import studio from '../studio.config'
import {ChevronRight, Desktop} from './icons'

/**
 * J62, Sanity's locations banner: "Used on N pages" over the form, unfolding to
 * the pages; each opens Presentation there with this document in its panel.
 * Shown for a type the studio config gives pages of its own (as Sanity's resolver
 * decides which types have a banner); Barkpark adds the referrers' pages.
 */
export function LocationsBanner({doc}: {doc: Doc}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const config = studio.presentation
  const own = config?.locations?.(doc)
  // Asked a moment after the pane opens: the document's own read goes first (F2).
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setAsked(true), 250)
    return () => clearTimeout(timer)
  }, [])
  const {data: referrers, isPending} = useQuery({...locationsQuery(doc._publishedId), enabled: asked && own !== undefined})
  if (!config || own === undefined) return null
  const origin = new URL(config.previewUrl).origin
  // A referrer's URL on our site reads as its path, as the config's own do.
  const all: Location[] = [...(own ?? []), ...(referrers ?? []).map((l) => ({...l, href: l.href.startsWith(origin) ? l.href.slice(origin.length) || '/' : l.href}))]
  const locations = all.filter((l, i) => all.findIndex((x) => x.href === l.href) === i)
  const label = isPending ? t('Resolving locations...') : locations.length === 0 ? t('Not used on any pages') : locations.length === 1 ? t('Used on one page') : t('Used on {count} pages', {count: locations.length})
  return (
    <section className="locations-banner" data-open={open || undefined}>
      <button type="button" className="locations-toggle" aria-expanded={open} disabled={!locations.length} onClick={() => setOpen((o) => !o)}>
        <span className="locations-chevron" data-open={open || undefined}>
          <ChevronRight />
        </span>
        {label}
      </button>
      {open && (
        <ul>
          {locations.map((l) => (
            <li key={l.href}>
              <Link to="/presentation" search={{preview: l.href.startsWith('/') ? l.href : undefined, pane: `${doc._type};${doc._publishedId}`}} className="location">
                <Desktop />
                <span>
                  <span>{l.title}</span>
                  <small>{l.href}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
