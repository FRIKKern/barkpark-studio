import {createContext, useContext} from 'react'

/**
 * J26, Sanity's focus mode: a document pane's header button hides the navigation (every
 * other pane) so the document gets the whole width. Kept by the pane area, not the URL,
 * as Sanity: a reload or any pane navigation shows the navigation again.
 */
export const FocusModeContext = createContext<{focused: number | null; toggle: (index: number) => void}>({focused: null, toggle: () => {}})
export const useFocusMode = () => useContext(FocusModeContext)
