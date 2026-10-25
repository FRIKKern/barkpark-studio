import {useEffect} from 'react'

// A state that styles far from where it lives, said on <html> as a data attribute while a
// component is mounted. CSS reads it as `html[data-…] …`. It stood in for `body:has(…)`, which
// had Chrome re-check the whole page on every DOM change it might affect: each keystroke's
// save-state swap cost 20-25 ms of style work at 4x CPU on a long form.
const counts = new Map<string, number>()

/** `<html data-{name}>` while any component calling this is mounted. */
export function useHtmlMark(name: string) {
  useEffect(() => {
    counts.set(name, (counts.get(name) ?? 0) + 1)
    document.documentElement.setAttribute(`data-${name}`, '')
    return () => {
      const left = (counts.get(name) ?? 1) - 1
      counts.set(name, left)
      if (!left) document.documentElement.removeAttribute(`data-${name}`)
    }
  }, [name])
}
