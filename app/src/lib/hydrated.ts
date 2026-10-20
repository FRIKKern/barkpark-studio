import {useEffect} from 'react'

/**
 * Marks the page interactive: `html[data-hydrated]` (e2e waits for it — a click or
 * key before hydration is lost or a full page load). Set by the page's own
 * component, not the root: route components load as split chunks and hydrate
 * after the root, so a root-level mark came before the navbar's Ctrl+K handler
 * existed (J19 flaked on it in CI). Cleared on unmount, so the next page sets its own.
 */
export function useHydratedMark() {
  useEffect(() => {
    let gone = false
    const mark = () => {
      if (gone) return
      document.documentElement.dataset.hydrated = ''
      releaseEarlyClicks()
    }
    if (markAfter) void markAfter.then(mark)
    else mark()
    return () => ((gone = true), void delete document.documentElement.dataset.hydrated)
  }, [])
}

let markAfter: Promise<unknown> | null = null
/**
 * A document page is interactive once its pane is live (components/DocPane.tsx), not when
 * its route mounts: the pane's chunk can land later, and until React hydrates it the form is
 * the server's inert HTML. At most MARK_WAIT_MS (a chunk that never comes), as before.
 */
export function holdMarkUntil(until: Promise<unknown>) {
  markAfter = Promise.race([until, new Promise((r) => setTimeout(r, MARK_WAIT_MS))])
}
const MARK_WAIT_MS = 15_000

/**
 * J51, inline in <head>: on a slow network the server-rendered page shows a while
 * before its code runs. Links work meanwhile (full page loads); a button would do
 * nothing, so its click is held (window.__earlyClicks) until releaseEarlyClicks(). Keys typed
 * into an input, and a checkbox, radio or select changed, are noted too (window.__earlyTyped)
 * and put in again (typeWhenLive).
 */
export const EARLY_CLICKS = `window.__earlyTyped=new Map();function __bpEarly(e){var m=window.__earlyTyped,t=e.target;if(!m||!t||!/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.type==='file')return;for(var k in t)if(k.indexOf('__reactProps$')===0)return;var box=t.id?t:t.closest('[id]'),key;if(box)key=t.id?t.id:box.id+'|'+t.tagName+'|'+[].indexOf.call(box.querySelectorAll(t.tagName),t);else{var l=__bpLabel(t);key='~'+t.tagName+'|'+[].filter.call(document.querySelectorAll(t.tagName),function(x){return __bpLabel(x)===l}).indexOf(t)+'|'+l}m.set(key,{el:t,value:t.value,checked:t.checked})}function __bpLabel(e){return e.getAttribute('aria-label')||(e.labels&&e.labels[0]&&e.labels[0].textContent.trim())||e.placeholder||e.name||''}document.addEventListener('input',__bpEarly,true);document.addEventListener('change',__bpEarly,true);window.__earlyClicks=[];document.addEventListener('click',function(e){var q=window.__earlyClicks;if(!q)return;var b=e.target.closest&&e.target.closest('button,[role=button]');if(!b)return;e.preventDefault();e.stopPropagation();q.indexOf(b)<0&&q.push(b)},true)`

let pending: Promise<unknown> | null = null
/**
 * J36: the document editors' inputs are live only once their chunk lands, which on a slow
 * link is after the page is marked interactive. Until `until` settles, a release waits:
 * releasing at the mark clicked the inert server-drawn Select, and the click was lost
 * (task-63978ba572421248).
 */
export function holdReleaseUntil(until: Promise<unknown>) {
  pending = until
}

/** The page is interactive: stop holding clicks and click what was held. Once per page load. */
export function releaseEarlyClicks() {
  if (pending) {
    const until = pending
    pending = null
    void until.then(releaseEarlyClicks)
    return
  }
  const w = window as {__earlyClicks?: HTMLElement[] | null; __earlyTyped?: Map<string, Noted> | null}
  const held = w.__earlyClicks ?? []
  w.__earlyClicks = null
  const at = performance.now()
  for (const el of held) clickWhenLive(el, at)
  const typed = w.__earlyTyped ?? new Map()
  w.__earlyTyped = null
  for (const [id, el] of typed) typeWhenLive(id, el)
}

/**
 * A held button is clicked once React has it: the same element hydrated, or the one React
 * drew anew in its place. Looked for each frame for three seconds, then clicked as it is.
 * "The chunk landed, two frames later" was not enough: with slow Barkpark reads (a deploy),
 * the editors' Suspense boundary hydrated later than that, the click went to the inert
 * server-drawn Select and was lost (task-0d76ab147c56c3c9, J36 on CI 2026-10-14 23:52 UTC).
 */
function clickWhenLive(el: HTMLElement, since: number, frames = 180) {
  // Pressed somewhere else meanwhile: the held click is stale, and clicking it now would
  // take the focus from where the person went (J10: the title lost its keys to the body).
  if (lastPointerDown > since) return
  const now = el.isConnected ? el : counterpart(el)
  if (now && (isLive(now) || frames === 0)) return void now.click()
  if (frames > 0) requestAnimationFrame(() => clickWhenLive(el, since, frames - 1))
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
/** What the control held when it was changed: hydrating can set the element back before it is redone. */
type Noted = {el: Control; value: string; checked: boolean}
/**
 * The same for keys (task-6fe143f72dc55f55) and native controls (task-c044d1ebab1e53dd): the
 * server-drawn form takes typing, ticks and picks before React has it, and none of it reached
 * the edit queue (silently lost on a slow load). EARLY_CLICKS notes each control changed while
 * inert, by its id (or its field's id and its place there: a checkbox list's boxes have none;
 * or, with neither, its label and its place among controls so labelled);
 * once React has the field (the same element, or the one drawn in its place) the change is
 * made again the way the field's own onChange hears it.
 */
function typeWhenLive(key: string, early: Noted, frames = 180, tries = 3) {
  const now = early.el.isConnected ? early.el : counterpartOf(key)
  if (now && isLive(now)) {
    redo(now, early)
    const at = performance.now()
    // A part React is still hydrating can take the change and then set the control back (a
    // checkbox did): looked at again a moment later, and made again while it doesn't hold,
    // unless the person changed it themselves meanwhile: their newer choice wins.
    return void setTimeout(() => {
      const after = early.el.isConnected ? early.el : counterpartOf(key)
      if (after && tries > 1 && (changedByHand.get(after) ?? 0) < at && !holds(after, early)) typeWhenLive(key, early, 60, tries - 1)
    }, 250)
  }
  if (frames > 0) requestAnimationFrame(() => typeWhenLive(key, early, frames - 1, tries))
}
const holds = (el: Control, early: Noted) => (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.checked === early.checked : el.value === early.value)
function counterpartOf(key: string): Control | null {
  // A control with no id and no id'd field around it (a select in a tool's toolbar): by its
  // tag, its label (aria-label, a <label>, placeholder or name) and its place among those.
  if (key.startsWith('~')) {
    const [tag, at] = key.slice(1).split('|')
    const label = key.slice(tag!.length + at!.length + 3)
    return ([...document.querySelectorAll<Control>(tag!)].filter((e) => labelOf(e) === label)[Number(at)] ?? null)
  }
  const [id, tag, at] = key.split('|')
  const box = document.getElementById(id!)
  return (tag ? box?.querySelectorAll(tag)[Number(at)] : box) as Control | null
}
const labelOf = (e: Control) => e.getAttribute('aria-label') || e.labels?.[0]?.textContent?.trim() || ('placeholder' in e ? e.placeholder : '') || e.name || ''
let redoing = false
function redo(el: Control, early: Noted) {
  redoing = true
  try {
    redoNow(el, early)
  } finally {
    redoing = false
  }
}
function redoNow(el: Control, early: Noted) {
  // React's onChange fires only for a value its tracker hasn't seen: hydrated in place, it saw this one.
  const tracker = (el as {_valueTracker?: {setValue: (v: string) => void}})._valueTracker
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    // A click is what React hears for these: from the other state, so it lands on the noted one.
    el.checked = !early.checked
    return el.click()
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, early.value)
  tracker?.setValue(early.value === '' ? ' ' : '')
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', {bubbles: true}))
}

let lastPointerDown = 0
// When the person last changed each control themselves (not the events a redo sets off: a
// redo's click fires trusted input and change events).
const changedByHand = new WeakMap<EventTarget, number>()
if (typeof window !== 'undefined') {
  addEventListener('pointerdown', (e) => e.isTrusted && (lastPointerDown = performance.now()), true)
  for (const type of ['input', 'change']) addEventListener(type, (e) => e.isTrusted && !redoing && e.target && changedByHand.set(e.target, performance.now()), true)
}

// React marks an element it has hydrated or rendered with its props (`__reactProps$<id>`).
const isLive = (el: HTMLElement) => Object.keys(el).some((k) => k.startsWith('__reactProps$'))

/**
 * J36: hydrating can draw a server-rendered part anew (the image field's options button
 * was replaced, and its held click went nowhere). The same button under the same id'd
 * ancestor: matched by its label, else its text.
 */
function counterpart(el: HTMLElement): HTMLElement | null {
  const label = el.getAttribute('aria-label')
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (!a.id) continue
    const now = document.getElementById(a.id)
    const buttons = now ? [...now.querySelectorAll<HTMLElement>('button,[role=button]')] : []
    return buttons.find((b) => (label ? b.getAttribute('aria-label') === label : b.textContent === el.textContent)) ?? null
  }
  return null
}
