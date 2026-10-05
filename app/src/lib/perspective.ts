import {useRouterState} from '@tanstack/react-router'

/** Sanity's perspective, from the URL: 'published' shows published versions read-only. */
export const usePublishedPerspective = () =>
  useRouterState({select: (s) => (s.location.search as {perspective?: string}).perspective === 'published'})
