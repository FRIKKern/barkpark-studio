# Third-party notices

Code ported from other projects, with the license it came under.

## Sanity (sanity 6.17.0, MIT; @sanity/locale-nb-no 1.1.39, MIT)

Ported: `app/src/lib/layout.ts` (pane collapse rule from
`packages/sanity/src/structure/components/pane/paneLayoutController.ts`). The Norwegian
in `app/src/i18n/nb/*.ts` takes Sanity's nb-NO strings where our English is Sanity's.

```
MIT License

Copyright (c) 2016 - 2026 Sanity.io

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Barkpark (FRIKKern/barkpark at daf78d095, Apache-2.0)

Copied: `app/src/vendor/barkpark-fleet.css`, the task/fleet block rules of
`api/assets/paper-surface/paper-surface.css`, until Barkpark serves that stylesheet to
external hosts (task-7fb8088ab39c7a36). Same owner as this repo.

## Barkdown (FRIKKern/barkdown at bb3c8ad7, Apache-2.0)

Ported: the save loop in `app/src/components/PortableDocEditor.tsx`. It comes from
`app/renderer/src/tabs/paper.js` (`applyOps`, the conflict card) and loads the bundle the
way `app/renderer/src/canvas-bundle.js` does. Same owner as this repo. At that commit the
Barkdown repo carries no LICENSE file; the license is as stated on the FF1 task.
