import {
  Suspense,
  use,
  useEffect,
  type ComponentProps,
  type ComponentType,
} from "react";

// Cold-load scout (2026-10-09, task-5242fdab0458e203): the image and file inputs, the
// Freeform canvas host and Review changes are only for a document pane, yet sat in every
// page's first chunk. They are one chunk now, fetched once the desk is idle (so opening
// the first document never waits on it) and, on the server, before any render.
type Mod = typeof import("./doc-editors");
let mod: Mod | undefined;
// Marked fulfilled when it lands (React's thenable fields), so use() reads it at once.
let pending: (Promise<Mod> & { status?: string; value?: Mod }) | undefined;
export const loadDocEditors = () =>
  (pending ??= import("./doc-editors").then(
    (m) => (
      Object.assign(pending!, { status: "fulfilled", value: m }),
      (mod = m)
    ),
  ));
if (import.meta.env.SSR) void loadDocEditors();

/** Fetch the chunk when the browser is idle (the desk calls this once it has rendered). */
export function usePrefetchDocEditors() {
  useEffect(() => {
    if (mod) return;
    const idle =
      (globalThis as { requestIdleCallback?: (f: () => void) => number })
        .requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
    idle(() => void loadDocEditors());
  }, []);
}

// Loaded: renders at once. Not yet: suspends until it is (fallback: nothing); use() on
// every render, never only on the first (React refuses a use() that comes and goes). The same
// Suspense boundary on the server and the client, so hydration keeps the server's HTML
// while the chunk is still on its way instead of failing over a different tree.
function From<K extends keyof Mod>({
  name,
  props,
}: {
  name: K;
  props: object;
}) {
  const C = use(loadDocEditors())[name] as ComponentType<object>;
  return <C {...props} />;
}
const lazyOf =
  <K extends keyof Mod>(name: K) =>
  (props: ComponentProps<Mod[K]>) => (
    <Suspense fallback={null}>
      <From name={name} props={props} />
    </Suspense>
  );

export const ImageInput = lazyOf("ImageInput");
export const FileInput = lazyOf("FileInput");
export const PortableDocEditor = lazyOf("PortableDocEditor");
export const ReviewChanges = lazyOf("ReviewChanges");
