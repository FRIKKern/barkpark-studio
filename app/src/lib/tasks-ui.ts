import { useSyncExternalStore } from "react";

// J66: the Tasks sidebar's place (closed, a tab of the list, the create form, one task)
// and the document the editor is on (the last pane's), for "Active Document" and a new
// task's target. Plain stores: the navbar, the doc menu and the panel share them.

export type TasksTab = "assigned" | "subscribed" | "document";
export type TaskTarget = { id: string; type: string };
export type TasksView =
  | { kind: "closed" }
  | { kind: "list"; tab: TasksTab }
  | { kind: "create"; target: TaskTarget | null }
  | { kind: "task"; id: string };

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => ((value = next), listeners.forEach((l) => l())),
    use: () =>
      useSyncExternalStore(
        (l) => (listeners.add(l), () => void listeners.delete(l)),
        () => value,
        () => initial,
      ),
  };
}

const view = store<TasksView>({ kind: "closed" });
export const useTasksView = view.use;
export const showTasks = view.set;
export const tasksView = view.get;

const active = store<TaskTarget | null>(null);
export const useActiveDocument = active.use;
/** The last pane's document (DocumentPane), or null when none is open. */
export const setActiveDocument = (doc: TaskTarget | null) => {
  const now = active.get();
  if (now?.id !== doc?.id || now?.type !== doc?.type) active.set(doc);
};
