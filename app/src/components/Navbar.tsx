import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { devSignOut, meQuery } from "../lib/session";
import { GlobalSearch } from "./Search";
import { NewDocMenu } from "./NewDocMenu";
import { ScopeSwitcher } from "./ScopeSwitcher";
import { WhoIsOnline } from "./Presence";
import { TasksPanel } from "./TasksPanel";
import { showTasks, useTasksView } from "../lib/tasks-ui";
import { DialogBox, MenuPopover } from "./FocusScopes";
import {
  CheckmarkCircle,
  ChevronDown,
  Close,
  Desktop,
  HelpCircle,
  MenuIcon,
  Moon,
  SignOut,
  Sun,
  UserCircle as UserIcon,
} from "./icons";
import { setAppearance, useAppearance, type Appearance } from "../lib/theme";
import { useEffect, useState } from "react";
import { useHydratedMark } from "../lib/hydrated";
import {
  BUILD,
  buildName,
  useNewVersion,
  useSchemaChanged,
} from "../lib/version";
import { saveAll } from "../lib/edits";
import { stickyToast } from "./Toasts";
import { useT } from "../lib/i18n";
import studio from "../studio.config";
import { studioBrand } from "../lib/plugins";
import { usePublishedPerspective, withPerspective } from "../lib/perspective";
import { useRouterState } from "@tanstack/react-router";

/** Sanity's navbar name and initials, from the studio config's title. */
const brand = studioBrand(studio.title);

export function Navbar() {
  useHydratedMark();
  const t = useT();
  const published = usePublishedPerspective();
  return (
    <nav
      className="navbar"
      data-perspective={published ? "published" : undefined}
    >
      <SchemaWatch />
      <TasksPanel />
      <div className="brand">
        <NavDrawer />
        <span className="logo">{brand.initials}</span>
        <span className="brand-name">{brand.name}</span>
        <ScopeSwitcher />
        <NewDocMenu />
        <GlobalSearch />
      </div>
      {/* J37: Sanity's tool switcher. The active tool is the highlighted tab. */}
      <div className="tools">
        {TOOLS.map(([to, label]) => (
          <Link
            key={to}
            to={to}
            search={(published ? { perspective: "published" } : {}) as never}
            className="tool"
            activeProps={{ className: "tool tab", "aria-current": "page" }}
          >
            {t(label)}
          </Link>
        ))}
      </div>
      <div className="nav-right">
        <PerspectivePicker />
        <WhoIsOnline />
        <TasksButton />
        <Help />
        <Editor />
      </div>
    </nav>
  );
}

/**
 * J46, Sanity's phone navbar: below 900 px the tools and the user menu move into
 * a drawer from the left (who you are, the tools, the appearance, Sign out), opened
 * by the menu button before the logo. Tab stays inside, Escape or Close shuts it,
 * picking a tool closes it.
 */
function NavDrawer() {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const appearance = useAppearance();
  const [open, setOpen] = useState(false);
  const signedIn = !!(me?.devLogin && me.email);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        className="icon-btn nav-drawer-btn"
        aria-label={t("Open menu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MenuIcon />
      </button>
      {open && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <DialogBox
            className="nav-drawer"
            aria-modal="true"
            aria-label={t("Menu")}
            onClose={close}
          >
            <header>
              {signedIn ? (
                <span className="user-initial">
                  {me!.email![0]!.toUpperCase()}
                </span>
              ) : (
                <span className="logo">B</span>
              )}
              <span className="drawer-who">
                {signedIn ? me!.email : "Barkpark Studio"}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("Close menu")}
                onClick={close}
              >
                <Close />
              </button>
            </header>
            <nav aria-label={t("Tools")}>
              {TOOLS.map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="drawer-item"
                  activeProps={{
                    className: "drawer-item on",
                    "aria-current": "page",
                  }}
                  onClick={close}
                >
                  {t(label)}
                </Link>
              ))}
            </nav>
            <div className="drawer-foot">
              {/* A phone's navbar has no room for Help (Sanity's has none there either): it is here. */}
              <Help inDrawer />
              <hr />
              {APPEARANCES.map(([a, label, Icon]) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={appearance === a}
                  aria-label={t(`Use ${a} appearance`)}
                  className="drawer-item check"
                  onClick={() => setAppearance(a)}
                >
                  <span className="menu-icon-text">
                    <Icon /> {t(label)}
                  </span>
                </button>
              ))}
              {signedIn && (
                <>
                  <hr />
                  <button
                    type="button"
                    className="drawer-item"
                    onClick={async () => {
                      close();
                      await devSignOut();
                      qc.clear();
                      await navigate({
                        to: "/login",
                        search: { redirect: "/structure" },
                      });
                    }}
                  >
                    <span className="menu-icon-text">
                      {t("Sign out")} <SignOut />
                    </span>
                  </button>
                </>
              )}
            </div>
          </DialogBox>
        </div>
      )}
    </>
  );
}

/**
 * Bad day: Barkpark's content model changed while this tab is open (a field removed, a
 * type changed). Say so, sticky, with Reload: what is typed is saved first, then the
 * page reads the new model. Until then the open form keeps the model it loaded.
 */
function SchemaWatch() {
  const t = useT();
  const qc = useQueryClient();
  const changed = useSchemaChanged();
  useEffect(() => {
    if (!changed) return;
    const reload = async () => (await saveAll(qc), location.reload());
    stickyToast("schema-changed", {
      tone: "caution",
      title: (
        <span>
          {t("The content model changed.")}{" "}
          <button
            type="button"
            className="btn-text"
            onClick={() => void reload()}
          >
            {t("Reload")}
          </button>
        </span>
      ),
      description: t(
        "Reload to see the fields as they are now. What you typed is saved first.",
      ),
    });
    return () => stickyToast("schema-changed", null);
  }, [changed, qc, t]);
  return null;
}

/**
 * J53, Sanity's "Help and resources" (top right): a dot on the button when a new
 * Studio version is out; the Studio item names this build and, when the server
 * runs a newer one, reads "Reload to update to …" and reloads once every waiting
 * edit is saved. Sanity's other entries become ours: report a problem, the docs.
 */
/** J66: Sanity's navbar Tasks button opens (or closes) the Tasks sidebar on its lists. */
function TasksButton() {
  const t = useT();
  const open = useTasksView().kind !== "closed";
  return (
    <button
      type="button"
      className="icon-btn"
      data-testid="tasks-toolbar"
      aria-label={t("Tasks")}
      data-tip={t("Tasks")}
      aria-pressed={open}
      onClick={() =>
        showTasks(open ? { kind: "closed" } : { kind: "list", tab: "assigned" })
      }
    >
      <CheckmarkCircle />
    </button>
  );
}

function Help({ inDrawer = false }: { inDrawer?: boolean }) {
  const t = useT();
  const next = useNewVersion();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setReloading(true);
    await saveAll(qc);
    location.reload();
  };
  return (
    <div
      className={inDrawer ? "menu-wrap help in-drawer" : "menu-wrap help"}
      onBlur={(e) =>
        !e.currentTarget.contains(e.relatedTarget) && setOpen(false)
      }
    >
      <button
        id={inDrawer ? "help-menu-drawer" : "help-menu"}
        type="button"
        className={inDrawer ? "drawer-item" : "icon-btn"}
        aria-label={t("Help and resources")}
        data-tip={
          inDrawer
            ? undefined
            : next
              ? t("New version available")
              : t("Help and resources")
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {inDrawer ? (
          <span className="menu-icon-text">
            <HelpCircle /> {t("Help and resources")}
            {next && <span className="update-dot" aria-hidden="true" />}
          </span>
        ) : (
          <>
            <HelpCircle />
            {next && <span className="update-dot" aria-hidden="true" />}
          </>
        )}
      </button>
      {open && (
        <MenuPopover
          className="popover menu help-menu"
          onClose={() => setOpen(false)}
          aria-labelledby={inDrawer ? "help-menu-drawer" : "help-menu"}
        >
          <a
            role="menuitem"
            className="menu-item"
            href="https://github.com/FRIKKern/barkpark-studio/issues/new/choose"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            {t("Report a problem")}
          </a>
          <hr />
          <button
            type="button"
            role="menuitem"
            className="menu-item studio-version"
            disabled={!next || reloading}
            data-update={next ? "" : undefined}
            onClick={reload}
          >
            <span className="version-text">
              <span>Barkpark Studio</span>
              <span className="muted">
                {reloading
                  ? t("Saving, then reloading…")
                  : next
                    ? buildName(next) === buildName(BUILD)
                      ? t("Reload to update")
                      : t("Reload to update to {version}", {
                          version: buildName(next),
                        })
                    : t("Up to date")}
              </span>
            </span>
            <span className="version-badge">{buildName(BUILD)}</span>
          </button>
          <hr />
          <a
            role="menuitem"
            className="menu-item"
            href="https://github.com/FRIKKern/barkpark-studio#readme"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            {t("Documentation")}
          </a>
        </MenuPopover>
      )}
    </div>
  );
}

/**
 * The user menu (Sanity's, top right): who you are, the appearance (J45: System,
 * Dark, Light, checked like radios) and, for dev sign-in, Sign out.
 */
function Editor() {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const appearance = useAppearance();
  const [open, setOpen] = useState(false);
  const signedIn = !!(me?.devLogin && me.email);
  const choose = (a: Appearance) => () => (setAppearance(a), setOpen(false));
  return (
    <div className="editor">
      {signedIn && (
        <span
          className="dev-badge"
          title={t("Dev sign-in: identity is asserted, not proven")}
        >
          DEV
        </span>
      )}
      <div
        className="menu-wrap"
        onBlur={(e) =>
          !e.currentTarget.contains(e.relatedTarget) && setOpen(false)
        }
      >
        <button
          id="user-menu"
          type="button"
          className="icon-btn user-btn"
          aria-label={t("Open user menu")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {signedIn ? (
            <span className="user-initial">{me!.email![0]!.toUpperCase()}</span>
          ) : (
            <UserIcon />
          )}
        </button>
        {open && (
          <MenuPopover
            className="popover menu user-menu"
            onClose={() => setOpen(false)}
            aria-labelledby="user-menu"
          >
            <div className="user-head">
              {signedIn ? me!.email : "Barkpark Studio"}
            </div>
            <hr />
            {APPEARANCES.map(([a, label, Icon]) => (
              <button
                key={a}
                type="button"
                role="menuitemradio"
                aria-checked={appearance === a}
                aria-label={t(`Use ${a} appearance`)}
                className="menu-item check"
                onClick={choose(a)}
              >
                <span className="menu-icon-text">
                  <Icon /> {t(label)}
                </span>
              </button>
            ))}
            {signedIn && (
              <>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item spread"
                  onClick={async () => {
                    setOpen(false);
                    await devSignOut();
                    qc.clear();
                    await navigate({
                      to: "/login",
                      search: { redirect: "/structure" },
                    });
                  }}
                >
                  <span className="menu-icon-text">{t("Sign out")}</span>
                  <SignOut />
                </button>
              </>
            )}
          </MenuPopover>
        )}
      </div>
    </div>
  );
}

// J58: Presentation after Structure, as Sanity's. J65: the config's tools follow the built-in ones.
// `navbarTools` (names, in order) picks and orders them for one deployment; hidden tools' routes still work.
const ALL_TOOLS: (readonly [string, string])[] = [
  ["/structure", "Structure"],
  ...(studio.presentation ? [["/presentation", "Presentation"] as const] : []),
  ["/vision", "Vision"],
  ["/media", "Media"],
  ...(studio.tools ?? []).map((tool) => [`/${tool.name}`, tool.title] as const),
];
const TOOLS = studio.navbarTools
  ? studio.navbarTools.flatMap((name) =>
      ALL_TOOLS.filter(([to]) => to === `/${name}`),
    )
  : ALL_TOOLS;

// Sanity's wording: the item reads "System", its name is "Use system appearance".
const APPEARANCES: [Appearance, string, () => React.JSX.Element][] = [
  ["system", "System", Desktop],
  ["dark", "Dark", Moon],
  ["light", "Light", Sun],
];

/**
 * J63, Sanity's perspective picker: Drafts (what editors work on) or Published,
 * for the whole studio — lists, documents (read-only) and Presentation's preview
 * follow ?perspective=, and links keep it. Releases are plan-gated on the reference,
 * so they are left out.
 */
function PerspectivePicker() {
  const t = useT();
  const navigate = useNavigate();
  const published = usePublishedPerspective();
  const here = useRouterState({ select: (s) => s.location.href });
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pick = (next: "published" | "drafts") => {
    close();
    if ((next === "published") === published) return;
    const [path, query = ""] = here.split(/\?(.*)/s);
    const q = new URLSearchParams(query);
    q.set("perspective", next);
    void navigate({ href: withPerspective(`${path}?${q}`, false) });
  };
  return (
    <div
      className="menu-wrap"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}
    >
      <button
        type="button"
        className="perspective-picker"
        aria-label={t("Perspective")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`dot ${published ? "published" : "draft-ring"}`}
          aria-hidden="true"
        />
        {published ? t("Published") : t("Drafts")}
        <ChevronDown />
      </button>
      {open && (
        <MenuPopover className="popover menu perspective-menu" onClose={close}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={published}
            className="menu-item"
            autoFocus={published}
            onClick={() => pick("published")}
          >
            <span className="menu-icon-text">
              <span className="dot published" aria-hidden="true" />{" "}
              {t("Published")}
            </span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!published}
            className="menu-item"
            autoFocus={!published}
            onClick={() => pick("drafts")}
          >
            <span className="menu-icon-text">
              <span className="dot draft-ring" aria-hidden="true" />{" "}
              {t("Drafts")}
            </span>
          </button>
        </MenuPopover>
      )}
    </div>
  );
}
