import {useEffect, useState} from 'react'

// J47: one polite live region that is always in the page, so screen readers
// hear what changed: a list's count, search results, a pane that opened,
// validation. A region inserted together with its text is often not read
// (VoiceOver), and the same text twice is read once, so the text is cleared
// first and set a moment later. It goes again after a few seconds: a reader has
// it by then, and stale text must not linger in the page.

let set: ((s: string) => void) | null = null
let last = ''
let clear: ReturnType<typeof setTimeout> | undefined

export function announce(text: string) {
  if (!text) return
  last = text
  set?.('')
  clearTimeout(clear)
  setTimeout(() => set?.(last), 100)
  clear = setTimeout(() => set?.(''), 3000)
}

/** The region itself, rendered once at the root. */
export function useAnnouncer() {
  const [text, setText] = useState('')
  useEffect(() => {
    set = setText
    return () => void (set = null)
  }, [])
  return text
}
