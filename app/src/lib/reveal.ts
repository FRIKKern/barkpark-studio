import {startTransition, useEffect, useState} from 'react'

// J44: a very long form (200 fields, a 300-row array) shows its first screenful
// in the first frame and the rest a moment later, in a transition React can
// interrupt — so opening it stays fast (F2) and typing never waits on it (F1).
// Only what is below the fold arrives late; nothing above it moves.
export function useRevealed(total: number, first: number, key: unknown) {
  const [shown, setShown] = useState({key, n: first})
  const current = shown.key === key ? shown : {key, n: first}
  if (current !== shown) setShown(current)
  useEffect(() => {
    if (current.n < total) startTransition(() => setShown({key, n: total}))
  }, [key, total, current.n])
  return Math.min(total, current.n)
}
