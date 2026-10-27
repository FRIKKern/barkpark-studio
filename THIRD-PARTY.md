# Third-party notices

Code ported from other projects, with the license it came under.

## Sanity (sanity 6.17.0, MIT; @sanity/icons 5.2.3, MIT; @sanity/locale-nb-no 1.1.39, MIT)

Ported: `app/src/lib/layout.ts` (pane collapse rule from
`packages/sanity/src/structure/components/pane/paneLayoutController.ts`). The Norwegian
in `app/src/i18n/nb/*.ts` takes Sanity's nb-NO strings where our English is Sanity's.

Ported: the icon paths in `app/src/components/icons.tsx`, from @sanity/icons 5.2.3, MIT.

Vendored: `app/src/lib/desk-icons.json`, every @sanity/icons 5.2.3 icon's SVG body by name, MIT (the desk icon vocabulary, shared with Barkpark's `priv/desk_icons.json`), plus lucide's `library` (lucide 0.460) and `megaphone`, `layout-grid`, `graduation-cap`, `languages`, `user-pen` and `tags` (lucide-static 1.61.0; also as `lucide:<name>`, and `tags` only as `lucide:tags`), and 50 more lucide-static 1.61.0 icons only as `lucide:<name>`, the ones gyldendal.no's twin names (ISC: "Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.").

Ported: the empty Releases illustration (`ReleaseIllustration` in
`app/src/components/icons.tsx`), from sanity 6.17.0, MIT
(`packages/sanity/src/core/releases/tool/resources/ReleaseIllustration.tsx`).

sanity:

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

@sanity/icons:

```
MIT License

Copyright (c) 2026 Sanity.io

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

## Barkdown (FRIKKern/barkdown at bb3c8ad7, Apache-2.0)

Ported: the save loop in `app/src/components/PortableDocEditor.tsx`. It comes from
`app/renderer/src/tabs/paper.js` (`applyOps`, the conflict card) and loads the bundle the
way `app/renderer/src/canvas-bundle.js` does. Same owner as this repo. At that commit the
Barkdown repo carries no LICENSE file; the license is as stated on the FF1 task.
