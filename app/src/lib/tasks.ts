import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { bpFetch, dataset } from "../server/barkpark";
import { currentEditor } from "../server/auth";

// J66, Sanity's Tasks. A task is a document of the schemaless type `studioTask` in the
// editor's own dataset (Barkpark's ruling, 2026-10-09: not Barkpark's `task` type or
// /v1/tasks, so nothing reaches bp's board, its GitHub mirror or its crons), kept out of
// the desk because no schema declares it, as comments are (lib/comments.ts). `state`
// is open or done (`status` is Barkpark's own draft/published word). Who created it is
// stamped here on the server from the signed-in editor, never sent by the page.

export const TASK_TYPE = "studioTask";
export type TaskState = "open" | "done";
export type Task = {
  _id: string;
  title: string;
  description?: string;
  /** The document the task is about. */
  target?: { _type: "reference"; _ref: string } | null;
  targetType?: string | null;
  /** An editor's email. */
  assignee?: string | null;
  /** yyyy-mm-dd */
  dueAt?: string | null;
  subscribers?: string[];
  state: TaskState;
  createdBy?: string | null;
  createdAt: string;
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

async function write(mutations: Json[]) {
  const res = await bpFetch(`/v1/data/mutate/${dataset()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutations }),
  });
  if (!res.ok) throw new Error(`Could not save the task (${res.status})`);
}

const fetchTasks = createServerFn({ method: "GET" }).handler(async () => {
  const res = await bpFetch(
    `/v1/data/query/${dataset()}/${TASK_TYPE}?perspective=drafts&limit=500&order=_createdAt:desc`,
  );
  if (!res.ok) throw new Error(`Could not load the tasks (${res.status})`);
  const docs = (
    (await res.json()) as {
      result: { documents: (Task & { _publishedId: string })[] };
    }
  ).result.documents;
  return docs.map(({ _publishedId, ...task }) => ({
    ...task,
    _id: _publishedId,
  })) as unknown as Json;
});

/** Every task in the dataset (a team's few hundred); the panel's tabs filter them. */
export const tasksQuery = queryOptions({
  queryKey: ["tasks"],
  staleTime: 10_000,
  queryFn: async () => (await fetchTasks()) as unknown as Task[],
});

/** The creator and the assignee follow a task, as in Sanity. */
const followers = (...emails: (string | null | undefined)[]) => [
  ...new Set(emails.filter((e): e is string => !!e)),
];

export type TaskInput = {
  title: string;
  description?: string;
  target?: { id: string; type: string } | null;
  assignee?: string | null;
  dueAt?: string | null;
};

export const createTask = createServerFn({ method: "POST" })
  .validator((d: TaskInput & { id: string }) => d)
  .handler(async ({ data }) => {
    const title = data.title.trim();
    if (!title) throw new Error("Title is required");
    const me = currentEditor()?.email ?? null;
    const doc = {
      _id: data.id,
      _type: TASK_TYPE,
      title,
      description: data.description?.trim() || "",
      target: data.target ? { _type: "reference", _ref: data.target.id } : null,
      targetType: data.target?.type ?? null,
      assignee: data.assignee ?? null,
      dueAt: data.dueAt || null,
      subscribers: followers(me, data.assignee),
      state: "open",
      createdBy: me,
      createdAt: new Date().toISOString(),
    };
    await write([
      { create: doc },
      { publish: { id: data.id, type: TASK_TYPE } },
    ]);
    return { id: data.id };
  });

/** Change a task: its state (Sanity's status toggle), or a field of the open task. */
export const updateTask = createServerFn({ method: "POST" })
  .validator(
    (d: {
      id: string;
      set: Partial<Omit<TaskInput, "target">> & {
        state?: TaskState;
        target?: { id: string; type: string } | null;
      };
      subscribers?: string[];
    }) => d,
  )
  .handler(async ({ data }) => {
    const { target, ...rest } = data.set;
    const set: Record<string, Json> = { ...(rest as Record<string, Json>) };
    if (target !== undefined)
      Object.assign(set, {
        target: target ? { _type: "reference", _ref: target.id } : null,
        targetType: target?.type ?? null,
      });
    // Whoever changes a task follows it (Sanity: "When you create, modify, or comment on a
    // task you will be subscribed automatically"), and so does a new assignee.
    set.subscribers = followers(
      ...(data.subscribers ?? []),
      currentEditor()?.email,
      data.set.assignee,
    );
    await write([
      { patch: { id: data.id, type: TASK_TYPE, set } },
      { publish: { id: data.id, type: TASK_TYPE } },
    ]);
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await write([{ delete: { id: data.id, type: TASK_TYPE, force: true } }]);
    return { ok: true };
  });
