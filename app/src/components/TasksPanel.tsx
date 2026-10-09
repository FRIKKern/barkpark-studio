import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  createTask,
  deleteTask,
  tasksQuery,
  updateTask,
  type Task,
  type TaskState,
} from "../lib/tasks";
import {
  showTasks,
  useActiveDocument,
  useTasksView,
  type TaskTarget,
  type TasksTab,
} from "../lib/tasks-ui";
import { mentionableQuery } from "../lib/comments";
import {
  anyDocQuery,
  previewTitle,
  schemaOf,
  schemasQuery,
  searchAllDocs,
  type Doc,
} from "../lib/data";
import { meQuery } from "../lib/session";
import { ago, useLocale, useT } from "../lib/i18n";
import { toast } from "./Toasts";
import { Add, CheckmarkCircle, Close, DocumentIcon, Trash } from "./icons";

/**
 * J66, Sanity's Tasks sidebar: the navbar's Tasks button opens it on the Assigned /
 * Subscribed / Active Document lists; a document's "Create new task" opens it on the
 * create form with that document as the target; a task opens on its own view with its
 * status, fields and activity. Docked at the right under the navbar, as Sanity's.
 */
export function TasksPanel() {
  const view = useTasksView();
  const open = view.kind !== "closed";
  useEffect(() => {
    if (!open) return;
    document.body.dataset.tasksOpen = "";
    return () => void delete document.body.dataset.tasksOpen;
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <aside className="tasks-panel" aria-label="Tasks">
      {view.kind === "list" && <TaskList tab={view.tab} />}
      {view.kind === "create" && (
        <CreateTask key={view.target?.id ?? "none"} target={view.target} />
      )}
      {view.kind === "task" && <TaskView id={view.id} />}
    </aside>,
    document.body,
  );
}

function Header({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <header className="tasks-head">
      {children}
      <button
        type="button"
        className="icon-btn"
        aria-label={t("Close sidebar")}
        data-tip={t("Close sidebar")}
        onClick={() => showTasks({ kind: "closed" })}
      >
        <Close />
      </button>
    </header>
  );
}

const TABS: [TasksTab, string][] = [
  ["assigned", "Assigned"],
  ["subscribed", "Subscribed"],
  ["document", "Active Document"],
];
const EMPTY: Record<TasksTab, [string, string]> = {
  assigned: [
    "You haven't been assigned any tasks",
    "Once you're assigned tasks they'll show up here",
  ],
  subscribed: [
    "You haven't subscribed to any tasks",
    "When you create, modify, or comment on a task you will be subscribed automatically",
  ],
  document: [
    "This document doesn't have any tasks yet",
    "Once a document has connected tasks, they will be shown here.",
  ],
};

function TaskList({ tab }: { tab: TasksTab }) {
  const t = useT();
  const me = useQuery(meQuery).data?.email ?? null;
  const active = useActiveDocument();
  const { data: tasks = [], isPending } = useQuery(tasksQuery);
  const shown = tasks.filter((x) =>
    tab === "assigned"
      ? !!me && x.assignee === me
      : tab === "subscribed"
        ? !!me && (x.subscribers ?? []).includes(me)
        : !!active && x.target?._ref === active.id,
  );
  const open = shown.filter((x) => x.state !== "done");
  const done = shown.filter((x) => x.state === "done");
  const [heading, text] =
    tab === "document" && !active
      ? [
          "Open a document to see its task",
          "Tasks on your active document will be shown here.",
        ]
      : EMPTY[tab];
  return (
    <>
      <Header>
        <h2>{t("Tasks")}</h2>
        <button
          type="button"
          className="btn-text tasks-new"
          onClick={() => showTasks({ kind: "create", target: active })}
        >
          <Add /> {t("New task")}
        </button>
      </Header>
      <div className="tasks-tabs" role="tablist" aria-label={t("Tasks")}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => showTasks({ kind: "list", tab: id })}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="tasks-body">
        {isPending ? (
          <p className="muted">{t("Loading…")}</p>
        ) : shown.length === 0 ? (
          <div className="tasks-empty">
            <h3>{t(heading)}</h3>
            <p>{t(text)}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => showTasks({ kind: "create", target: active })}
            >
              <Add /> {t("Create new task")}
            </button>
          </div>
        ) : (
          <>
            <ul className="tasks-list" aria-label={t("Open")}>
              {open.map((x) => (
                <TaskRow key={x._id} task={x} />
              ))}
            </ul>
            {done.length > 0 && (
              <details className="tasks-done">
                <summary>
                  {t("Done")} <span className="muted">{done.length}</span>
                </summary>
                <ul className="tasks-list" aria-label={t("Done")}>
                  {done.map((x) => (
                    <TaskRow key={x._id} task={x} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Sanity's status toggle: an empty circle while open, a check when done. */
function StatusToggle({ task }: { task: Task }) {
  const t = useT();
  const qc = useQueryClient();
  const done = task.state === "done";
  const flip = async () => {
    const state: TaskState = done ? "open" : "done";
    qc.setQueryData<Task[]>(tasksQuery.queryKey, (all) =>
      all?.map((x) => (x._id === task._id ? { ...x, state } : x)),
    );
    try {
      await updateTask({
        data: { id: task._id, set: { state }, subscribers: task.subscribers },
      });
    } catch (e) {
      toast({
        tone: "critical",
        title: t("Could not save the task"),
        description: (e as Error).message,
      });
    }
    void qc.invalidateQueries({ queryKey: tasksQuery.queryKey });
  };
  return (
    <button
      type="button"
      className="task-status"
      data-done={done || undefined}
      role="checkbox"
      aria-checked={done}
      aria-label={t("Change status")}
      data-tip={t("Change status")}
      onClick={() => void flip()}
    >
      {done ? <CheckmarkCircle /> : <span className="task-circle" />}
    </button>
  );
}

function TaskRow({ task }: { task: Task }) {
  const t = useT();
  const locale = useLocale();
  return (
    <li className="task-row" data-done={task.state === "done" || undefined}>
      <StatusToggle task={task} />
      <div className="task-text">
        <button
          type="button"
          className="task-title"
          onClick={() => showTasks({ kind: "task", id: task._id })}
        >
          {task.title}
        </button>
        <span className="task-meta muted">
          {task.target && <TargetTitle id={task.target._ref} />}
          {task.dueAt && (
            <span>
              {new Date(`${task.dueAt}T00:00:00`).toLocaleDateString(
                locale === "nb-NO" ? "nb-NO" : "en-US",
                { month: "short", day: "numeric" },
              )}
            </span>
          )}
        </span>
      </div>
      {task.assignee ? (
        <span
          className="task-assignee"
          title={task.assignee}
          aria-label={task.assignee}
        >
          {task.assignee.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <span
          className="task-assignee none"
          title={t("Unassigned")}
          aria-label={t("Unassigned")}
        />
      )}
    </li>
  );
}

function TargetTitle({ id }: { id: string }) {
  const t = useT();
  const { data: doc } = useQuery(anyDocQuery(id));
  const { data: schemas = [] } = useQuery(schemasQuery);
  return (
    <span>
      {doc ? previewTitle(doc, schemaOf(schemas, doc._type), t) : "…"}
    </span>
  );
}

/** The task's target: its title, a way to open it, and (editable) to remove or pick one. */
function TargetField({
  target,
  onChange,
  open,
}: {
  target: TaskTarget | null;
  onChange?: (next: TaskTarget | null) => void;
  open?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Doc[]>([]);
  const { data: schemas = [] } = useQuery(schemasQuery);
  useEffect(() => {
    if (!q.trim()) return setHits([]);
    let live = true;
    void searchAllDocs(q).then((d) => live && setHits(d.slice(0, 8)));
    return () => void (live = false);
  }, [q]);
  if (target)
    return (
      <div className="task-target">
        <DocumentIcon />
        <TargetTitle id={target.id} />
        {open && (
          <button
            type="button"
            className="btn-text"
            onClick={() =>
              void router.navigate({
                href: `/structure/${target.type};${target.id}`,
              })
            }
          >
            {t("Open")}
          </button>
        )}
        {onChange && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t("Remove target content")}
            data-tip={t("Remove target content")}
            onClick={() => onChange(null)}
          >
            <Close />
          </button>
        )}
      </div>
    );
  if (!onChange) return null;
  return (
    <div className="task-target-search">
      <input
        className="input"
        placeholder={t("Select target document")}
        aria-label={t("Target")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {hits.length > 0 && (
        <ul className="task-target-hits">
          {hits.map((d) => (
            <li key={d._id}>
              <button
                type="button"
                onClick={() => (
                  onChange({ id: d._publishedId, type: d._type }),
                  setQ("")
                )}
              >
                {previewTitle(d, schemaOf(schemas, d._type), t)}{" "}
                <span className="muted">
                  {schemaOf(schemas, d._type)?.title ?? d._type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssigneeField({
  value,
  onChange,
  id,
}: {
  value: string | null;
  onChange: (email: string | null) => void;
  id: string;
}) {
  const t = useT();
  const { data: people = [] } = useQuery(mentionableQuery);
  return (
    <select
      id={id}
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t("Select assignee")}</option>
      {[...new Set([...people, ...(value ? [value] : [])])].map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

function CreateTask({ target: initial }: { target: TaskTarget | null }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState<TaskTarget | null>(initial);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState("");
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const create = async () => {
    if (!title.trim()) return setError(t("Title is required"));
    setBusy(true);
    try {
      const id = `task-${crypto.randomUUID()}`;
      await createTask({
        data: {
          id,
          title,
          description,
          target,
          assignee,
          dueAt: dueAt || null,
        },
      });
      void qc.invalidateQueries({ queryKey: tasksQuery.queryKey });
      toast({ tone: "positive", title: t("Task created") });
      if (more) {
        setTitle("");
        setDescription("");
        setError(undefined);
        titleRef.current?.focus();
      } else showTasks({ kind: "task", id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Header>
        <nav className="tasks-crumbs" aria-label={t("Tasks")}>
          <button
            type="button"
            className="btn-text"
            onClick={() => showTasks({ kind: "list", tab: "assigned" })}
          >
            {t("Tasks")}
          </button>
          <span aria-hidden="true">›</span>
          <h2>{t("Create")}</h2>
        </nav>
      </Header>
      <form
        className="tasks-body task-form"
        onSubmit={(e) => (e.preventDefault(), void create())}
      >
        <textarea
          ref={titleRef}
          className="task-title-input"
          rows={1}
          placeholder={t("Task title")}
          aria-label={t("Task title")}
          value={title}
          onChange={(e) => (setTitle(e.target.value), setError(undefined))}
        />
        <textarea
          className="input task-description"
          rows={9}
          placeholder={t("Add description")}
          aria-label={t("Add description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="task-label">{t("Target")}</label>
        <TargetField target={target} onChange={setTarget} />
        <label className="task-label" htmlFor={`${ids}-assignee`}>
          {t("Assign to")}
        </label>
        <AssigneeField
          id={`${ids}-assignee`}
          value={assignee}
          onChange={setAssignee}
        />
        <label className="task-label" htmlFor={`${ids}-due`}>
          {t("Deadline")}
        </label>
        <input
          id={`${ids}-due`}
          className="input"
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="task-form-foot">
          <label className="task-more">
            <input
              type="checkbox"
              role="switch"
              checked={more}
              onChange={(e) => setMore(e.target.checked)}
            />{" "}
            {t("Create more")}
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t("Create Task")}
          </button>
        </div>
      </form>
    </>
  );
}

function TaskView({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const ids = useId();
  const { data: tasks, isPending } = useQuery(tasksQuery);
  const task = tasks?.find((x) => x._id === id);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  useEffect(
    () =>
      void (
        task && (setTitle(task.title), setDescription(task.description ?? ""))
      ),
    [task?._id],
  );
  const save = async (set: Parameters<typeof updateTask>[0]["data"]["set"]) => {
    if (!task) return;
    qc.setQueryData<Task[]>(
      tasksQuery.queryKey,
      (all) =>
        all?.map((x) =>
          x._id === id
            ? {
                ...x,
                ...set,
                ...(set.target !== undefined
                  ? {
                      target: set.target
                        ? { _type: "reference" as const, _ref: set.target.id }
                        : null,
                      targetType: set.target?.type ?? null,
                    }
                  : {}),
              }
            : x,
        ) as Task[],
    );
    try {
      await updateTask({ data: { id, set, subscribers: task.subscribers } });
    } catch (e) {
      toast({
        tone: "critical",
        title: t("Could not save the task"),
        description: (e as Error).message,
      });
    }
    void qc.invalidateQueries({ queryKey: tasksQuery.queryKey });
  };
  const remove = async () => {
    await deleteTask({ data: { id } });
    void qc.invalidateQueries({ queryKey: tasksQuery.queryKey });
    showTasks({ kind: "list", tab: "assigned" });
  };
  return (
    <>
      <Header>
        <nav className="tasks-crumbs" aria-label={t("Tasks")}>
          <button
            type="button"
            className="btn-text"
            onClick={() => showTasks({ kind: "list", tab: "assigned" })}
          >
            {t("Tasks")}
          </button>
          <span aria-hidden="true">›</span>
          <h2>{task?.title ?? "…"}</h2>
        </nav>
      </Header>
      <div className="tasks-body task-form">
        {isPending && <p className="muted">{t("Loading…")}</p>}
        {!isPending && !task && <p className="muted">{t("No tasks")}</p>}
        {task && (
          <>
            <div className="task-view-title">
              <StatusToggle task={task} />
              <textarea
                className="task-title-input"
                rows={1}
                aria-label={t("Task title")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() =>
                  title.trim() &&
                  title !== task.title &&
                  void save({ title: title.trim() })
                }
              />
            </div>
            <textarea
              className="input task-description"
              rows={6}
              placeholder={t("Add description")}
              aria-label={t("Add description")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                description !== (task.description ?? "") &&
                void save({ description })
              }
            />
            <label className="task-label">{t("Target")}</label>
            <TargetField
              target={
                task.target
                  ? { id: task.target._ref, type: task.targetType ?? "" }
                  : null
              }
              onChange={(next) => void save({ target: next })}
              open
            />
            <label className="task-label" htmlFor={`${ids}-assignee`}>
              {t("Assign to")}
            </label>
            <AssigneeField
              id={`${ids}-assignee`}
              value={task.assignee ?? null}
              onChange={(assignee) => void save({ assignee })}
            />
            <label className="task-label" htmlFor={`${ids}-due`}>
              {t("Deadline")}
            </label>
            <input
              id={`${ids}-due`}
              className="input"
              type="date"
              value={task.dueAt ?? ""}
              onChange={(e) => void save({ dueAt: e.target.value || null })}
            />
            <section className="task-activity" aria-label={t("Activity")}>
              <h3>{t("Activity")}</h3>
              <p>
                <b>{task.createdBy ?? t("Unknown user")}</b>{" "}
                {t("created this task")}{" "}
                <span className="muted">{ago(task.createdAt, locale)}</span>
              </p>
            </section>
            <div className="task-form-foot">
              <button
                type="button"
                className="btn-text task-delete"
                onClick={() => void remove()}
              >
                <Trash /> {t("Delete task")}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
