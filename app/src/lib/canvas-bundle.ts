import {canvasOrigin} from './blocks'
import {t as translate} from './i18n'

// Barkpark's <bp-paper-canvas>, loaded once per page from the connected Barkpark: the
// Freeform canvas (components/PortableDocEditor.tsx) and the rich text field's toolbar
// (components/BodyToolbar.tsx, which needs to know what the canvas can do before the
// field wakes) share it.
let bundle: Promise<void> | null = null
/** Load the canvas once per page: script + its stylesheets, from the connected Barkpark. */
export function loadCanvas(): Promise<void> {
  bundle ??= (async () => {
    const origin = await canvasOrigin()
    // Its own CSS inject is origin-relative (wrong origin here): link them ourselves.
    ;(window as {BP_PAPER_EDITOR_NO_INJECT?: boolean}).BP_PAPER_EDITOR_NO_INJECT = true
    // bp-paper-surface.css (Barkpark #22541): the paper surface's own rules, the task and
    // fleet blocks among them (D14).
    for (const css of ['bp-paper-editor.css', 'bp-paper-editor-shell.css', 'bp-paper-surface.css']) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `${origin}/assets/${css}`
      document.head.appendChild(link)
    }
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `${origin}/assets/bp-paper-editor.bundle.js`
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(translate('could not load the editor from {origin}', {origin})))
      document.head.appendChild(script)
    })
    await customElements.whenDefined('bp-paper-canvas')
  })().catch((e) => {
    bundle = null
    throw e
  })
  return bundle
}

/** The loaded canvas's EMBED-CONTRACT version (bp-paper-editor's CONTRACT_VERSION) is at least major.minor. */
export function canvasAtLeast(major: number, minor: number): boolean {
  const v = (customElements.get('bp-paper-editor') as {CONTRACT_VERSION?: string} | undefined)?.CONTRACT_VERSION ?? ''
  const [a = 0, b = 0] = v.split('.').map(Number)
  return a > major || (a === major && b >= minor)
}
