import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Link, useNavigate} from '@tanstack/react-router'
import {meQuery} from '../lib/session'
import {signOutHere} from '../lib/sign-out'
import {GlobalSearch} from './Search'
import {NewDocMenu} from './NewDocMenu'
import {ScopeSwitcher} from './ScopeSwitcher'
import {ActorAvatar, WhoIsOnline} from './Presence'
import {TasksPanel} from './TasksPanel'
import {Diagnostics} from './Diagnostics'
import {showTasks, useTasksView} from '../lib/tasks-ui'
import {DialogBox, MenuPopover} from './FocusScopes'
import {CheckmarkCircle, ChevronDown, Close, Desktop, HelpCircle, MenuIcon, Moon, SignOut, Sun, UserCircle as UserIcon, BugIcon, FeedbackIcon} from './icons'
import {setAppearance, useAppearance, type Appearance} from '../lib/theme'
import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {useHydratedMark} from '../lib/hydrated'
import {BUILD, buildName, useNewVersion, useSchemaChanged} from '../lib/version'
import {saveAll} from '../lib/edits'
import {stickyToast} from './Toasts'
import {intlTag, useLocale, useT} from '../lib/i18n'
import studio from '../studio.config'
import {studioBrand} from '../lib/plugins'
import {usePublishedPerspective, withPerspective} from '../lib/perspective'
import {useRouterState} from '@tanstack/react-router'

/** Sanity's navbar name and initials, from the studio config's title. */
const brand = studioBrand(studio.title)

export function Navbar() {
  useHydratedMark()
  const t = useT()
  const published = usePublishedPerspective()
  return (
    <nav className="navbar" data-perspective={published ? 'published' : undefined}>
      <SchemaWatch />
      <TasksPanel />
      <div className="brand">
        <NavDrawer />
        <span className="logo">{brand.initials}</span>
        <ScopeSwitcher brand={brand} />
        <NewDocMenu />
        <GlobalSearch />
      </div>
      {/* J37: Sanity's tool switcher. The active tool is the highlighted tab. */}
      <div className="tools">
        {TOOLS.map(([to, label]) => (
          <Link key={to} to={to} search={(published ? {perspective: 'published'} : {}) as never} className="tool" activeProps={{className: 'tool tab', 'aria-current': 'page'}}>
            {t(label)}
          </Link>
        ))}
      </div>
      <div className="nav-right">
        <PerspectivePicker />
        {/* Sanity's order: Tasks, presence, help, the user. */}
        <TasksButton />
        <WhoIsOnline />
        <Help />
        <Editor />
      </div>
    </nav>
  )
}

/**
 * J46, Sanity's phone navbar: below 900 px the tools and the user menu move into
 * a drawer from the left (who you are, the tools, the appearance, Sign out), opened
 * by the menu button before the logo. Tab stays inside, Escape or Close shuts it,
 * picking a tool closes it.
 */
function NavDrawer() {
  const t = useT()
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Sign out returns here once signed in again, as Sanity's (task-701f8a5fdb6b4d52).
  const here = useRouterState({select: (st) => st.location.href})
  const appearance = useAppearance()
  const [open, setOpen] = useState(false)
  const signedIn = !!(me && me.signIn !== 'shared' && me.email)
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className="icon-btn nav-drawer-btn" aria-label={t('Open menu')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MenuIcon />
      </button>
      {open && (
        <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <DialogBox className="nav-drawer" aria-modal="true" aria-label={t('Menu')} onClose={close}>
            <header>
              {signedIn ? <ActorAvatar actor={me!.name ?? me!.email!} /> : <span className="logo">B</span>}
              <span className="drawer-who">{signedIn ? (me!.name ?? me!.email) : 'Barkpark Studio'}</span>
              <button type="button" className="icon-btn" aria-label={t('Close menu')} onClick={close}>
                <Close />
              </button>
            </header>
            <nav aria-label={t('Tools')}>
              {TOOLS.map(([to, label]) => (
                <Link key={to} to={to} className="drawer-item" activeProps={{className: 'drawer-item on', 'aria-current': 'page'}} onClick={close}>
                  {t(label)}
                </Link>
              ))}
            </nav>
            <div className="drawer-foot">
              {/* A phone's navbar has no room for Tasks or Help (Sanity's has neither there): they are here. */}
              <TasksButton inDrawer onPick={close} />
              <Help inDrawer />
              <hr />
              {APPEARANCES.map(([a, label, Icon]) => (
                <button key={a} type="button" aria-pressed={appearance === a} aria-label={t(`Use ${a} appearance`)} className="drawer-item check" onClick={() => setAppearance(a)}>
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
                      close()
                      await signOutHere(qc)
                      await navigate({to: '/login', search: {redirect: here}})
                    }}
                  >
                    <span className="menu-icon-text">
                      {t('Sign out')} <SignOut />
                    </span>
                  </button>
                </>
              )}
            </div>
          </DialogBox>
        </div>
      )}
    </>
  )
}

/**
 * Bad day: Barkpark's content model changed while this tab is open (a field removed, a
 * type changed). Say so, sticky, with Reload: what is typed is saved first, then the
 * page reads the new model. Until then the open form keeps the model it loaded.
 */
function SchemaWatch() {
  const t = useT()
  const qc = useQueryClient()
  const changed = useSchemaChanged()
  useEffect(() => {
    if (!changed) return
    const reload = async () => (await saveAll(qc), location.reload())
    stickyToast('schema-changed', {
      tone: 'caution',
      title: (
        <span>
          {t('The content model changed.')}{' '}
          <button type="button" className="btn-text" onClick={() => void reload()}>
            {t('Reload')}
          </button>
        </span>
      ),
      description: t('Reload to see the fields as they are now. What you typed is saved first.'),
    })
    return () => stickyToast('schema-changed', null)
  }, [changed, qc, t])
  return null
}

/**
 * J53, Sanity's "Help and resources" (top right): a dot on the button when a new
 * Studio version is out; the Studio item names this build and, when the server
 * runs a newer one, reads "Reload to update to …" and reloads once every waiting
 * edit is saved. Sanity's other entries become ours: report a problem, the docs.
 */
/** J66: Sanity's navbar Tasks button opens (or closes) the Tasks sidebar on its lists. */
function TasksButton({inDrawer = false, onPick}: {inDrawer?: boolean; onPick?: () => void}) {
  const t = useT()
  const open = useTasksView().kind !== 'closed'
  const toggle = () => {
    showTasks(open ? {kind: 'closed'} : {kind: 'list', tab: 'assigned'})
    onPick?.()
  }
  if (inDrawer)
    return (
      <button type="button" className="drawer-item drawer-tasks" aria-pressed={open} onClick={toggle}>
        <span className="menu-icon-text">
          <CheckmarkCircle /> {t('Tasks')}
        </span>
      </button>
    )
  return (
    <button type="button" className="icon-btn tasks-btn" data-testid="tasks-toolbar" aria-label={t('Tasks')} data-tip={t('Tasks')} aria-pressed={open} onClick={toggle}>
      <CheckmarkCircle />
    </button>
  )
}

function Help({inDrawer = false}: {inDrawer?: boolean}) {
  const t = useT()
  const next = useNewVersion()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState(false)
  const [version, setVersion] = useState(false)
  const [whatsNew, setWhatsNew] = useState(false)
  const [reloading, setReloading] = useState(false)
  const reload = async () => {
    setReloading(true)
    await saveAll(qc)
    location.reload()
  }
  return (
    <div className={inDrawer ? 'menu-wrap help in-drawer' : 'menu-wrap help'} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button
        id={inDrawer ? 'help-menu-drawer' : 'help-menu'}
        type="button"
        className={inDrawer ? 'drawer-item' : 'icon-btn'}
        aria-label={t('Help and resources')}
        data-tip={inDrawer ? undefined : next ? t('New version available') : t('Help and resources')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {inDrawer ? (
          <span className="menu-icon-text">
            <HelpCircle /> {t('Help and resources')}
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
        <MenuPopover className="popover menu help-menu" onClose={() => setOpen(false)} aria-labelledby={inDrawer ? 'help-menu-drawer' : 'help-menu'}>
          {/* Sanity's first two, with their icons: Send feedback (ours: report a problem) and Diagnostics. */}
          <a role="menuitem" className="menu-item" href="https://github.com/FRIKKern/barkpark-studio/issues/new/choose" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <span className="menu-icon-text">
              <FeedbackIcon /> {t('Report a problem')}
            </span>
          </a>
          {/* J69: Sanity's Diagnostics: what a bug report needs, copyable. */}
          <button type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), setDiagnostics(true))}>
            <span className="menu-icon-text">
              <BugIcon /> {t('Diagnostics')}
            </span>
          </button>
          <hr />
          {/* Up to date, it opens the version dialog, as Sanity's; with a newer build, it reloads to it. */}
          <button type="button" role="menuitem" className="menu-item studio-version" disabled={reloading} data-update={next ? '' : undefined} onClick={() => (next ? void reload() : (setOpen(false), setVersion(true)))}>
            <span className="version-text">
              <span>Barkpark Studio</span>
              <span className="muted">
                {reloading
                  ? t('Saving, then reloading…')
                  : next
                    ? buildName(next) === buildName(BUILD)
                      ? t('Reload to update')
                      : t('Reload to update to {version}', {version: buildName(next)})
                    : t('Up to date')}
              </span>
            </span>
            <span className="version-badge">{buildName(BUILD)}</span>
          </button>
          <hr />
          <a role="menuitem" className="menu-item" href="https://github.com/FRIKKern/barkpark-studio#readme" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            {t('Documentation')}
          </a>
          {/* Sanity's Changelog (the README's timeline of merged changes) and What's new, in the studio. */}
          <a role="menuitem" className="menu-item" href={CHANGELOG} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            {t('Changelog')}
          </a>
          <button type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), setWhatsNew(true))}>
            {t("What's new")}
          </button>
        </MenuPopover>
      )}
      {diagnostics && <Diagnostics onClose={() => setDiagnostics(false)} />}
      {version && <VersionDialog onClose={() => setVersion(false)} />}
      {whatsNew && <WhatsNewDialog onClose={() => setWhatsNew(false)} />}
    </div>
  )
}

const CHANGELOG = 'https://github.com/FRIKKern/barkpark-studio#what-happened'

/** Sanity's What's new, in the studio: this build's latest merged changes, each a link to its PR. */
function WhatsNewDialog({onClose}: {onClose: () => void}) {
  const t = useT()
  const locale = useLocale()
  const day = new Intl.DateTimeFormat(intlTag(locale), {month: 'short', day: 'numeric', timeZone: 'UTC'})
  return createPortal(
    <div className="dialog-backdrop diagnostics-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog whats-new-dialog" aria-modal="true" aria-label={t("What's new")} onClose={onClose}>
        <header>
          <h2>{t("What's new")}</h2>
          <button type="button" className="icon-btn" aria-label={t('Close')} onClick={onClose}>
            <Close />
          </button>
        </header>
        <div className="dialog-body">
          {__STUDIO_CHANGES__.length ? (
            <ul className="whats-new">
              {__STUDIO_CHANGES__.map((c) => (
                <li key={c.pr}>
                  <time dateTime={c.date}>{day.format(new Date(`${c.date}T00:00:00Z`))}</time>
                  <a href={`https://github.com/FRIKKern/barkpark-studio/pull/${c.pr}`} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('No changes are listed in this build.')}</p>
          )}
        </div>
        <footer className="whats-new-foot">
          <a href={CHANGELOG} target="_blank" rel="noreferrer">
            {t('Full changelog on GitHub')} →
          </a>
        </footer>
      </DialogBox>
    </div>,
    document.body,
  )
}

/** Sanity's studio version dialog: which build this tab runs, that it is current, its commit. */
function VersionDialog({onClose}: {onClose: () => void}) {
  const t = useT()
  const locale = useLocale()
  const [commit = BUILD, at] = BUILD.split('-')
  const built = at ? new Date(parseInt(at, 36)) : null
  return createPortal(
    <div className="dialog-backdrop diagnostics-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <DialogBox className="dialog version-dialog" aria-modal="true" aria-label={t('Studio version')} onClose={onClose}>
        <div className="dialog-body version-body">
          <span className="logo version-logo" aria-hidden="true">{brand.initials}</span>
          <p className="version-name">
            <strong>Barkpark Studio</strong>
            {/^[0-9a-f]{7,}$/.test(commit) ? (
              <a className="version-badge" href={`https://github.com/FRIKKern/barkpark-studio/commit/${commit}`} target="_blank" rel="noreferrer" aria-label={t('Open commit {commit} on GitHub', {commit})}>
                {commit}
              </a>
            ) : (
              <span className="version-badge">{commit}</span>
            )}
          </p>
          <p className="version-state">
            {t('Up to date')}
            {built && !Number.isNaN(built.getTime()) && ` · ${t('Built {date}', {date: new Intl.DateTimeFormat(intlTag(locale), {dateStyle: 'medium', timeStyle: 'short'}).format(built)})}`}
          </p>
        </div>
        <footer>
          <button type="button" className="publish" autoFocus onClick={onClose}>
            {t('OK')}
          </button>
        </footer>
      </DialogBox>
    </div>,
    document.body,
  )
}

/**
 * The user menu (Sanity's, top right): who you are, the appearance (J45: System,
 * Dark, Light, checked like radios) and, for dev sign-in, Sign out.
 */
function Editor() {
  const t = useT()
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Sign out returns here once signed in again, as Sanity's (task-701f8a5fdb6b4d52).
  const here = useRouterState({select: (st) => st.location.href})
  const appearance = useAppearance()
  const [open, setOpen] = useState(false)
  const signedIn = !!(me && me.signIn !== 'shared' && me.email)
  const choose = (a: Appearance) => () => (setAppearance(a), setOpen(false))
  return (
    <div className="editor">
      {signedIn && me!.devLogin && (
        <span className="dev-badge" title={t('Dev sign-in: identity is asserted, not proven')}>
          DEV
        </span>
      )}
      <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
        <button id="user-menu" type="button" className="icon-btn user-btn" aria-label={t('Open user menu')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {signedIn ? <ActorAvatar actor={me!.name ?? me!.email!} /> : <UserIcon />}
        </button>
        {open && (
          <MenuPopover className="popover menu user-menu" onClose={() => setOpen(false)} aria-labelledby="user-menu">
            {/* Sanity's: the avatar, the name, and the role here (task-701f8a5fdb6b4d52). */}
            {signedIn ? (
              <div className="user-head">
                <ActorAvatar actor={me!.name ?? me!.email!} />
                <span className="user-who">
                  <span className="user-name">{me!.name ?? me!.email}</span>
                  {me!.name && <span className="user-email">{me!.email}</span>}
                  {me!.role && <span className="user-role">{me!.role[0]!.toUpperCase() + me!.role.slice(1)}</span>}
                </span>
              </div>
            ) : (
              <div className="user-head">Barkpark Studio</div>
            )}
            <hr />
            {APPEARANCES.map(([a, label, Icon]) => (
              <button key={a} type="button" role="menuitemradio" aria-checked={appearance === a} aria-label={t(`Use ${a} appearance`)} className="menu-item check" onClick={choose(a)}>
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
                    setOpen(false)
                    await signOutHere(qc)
                    await navigate({to: '/login', search: {redirect: here}})
                  }}
                >
                  <span className="menu-icon-text">{t('Sign out')}</span>
                  <SignOut />
                </button>
              </>
            )}
          </MenuPopover>
        )}
      </div>
    </div>
  )
}

// J58: Presentation after Structure, as Sanity's. J65: the config's tools follow the built-in ones.
// `navbarTools` (names, in order) picks and orders them for one deployment; hidden tools' routes still work.
const ALL_TOOLS: (readonly [string, string])[] = [
  ['/structure', 'Structure'],
  ...(studio.presentation ? [['/presentation', 'Presentation'] as const] : []),
  ['/vision', 'Vision'],
  ['/media', 'Media'],
  ...(studio.tools ?? []).map((tool) => [`/${tool.name}`, tool.title] as const),
]
const TOOLS = studio.navbarTools
  ? studio.navbarTools.flatMap((name) => ALL_TOOLS.filter(([to]) => to === `/${name}`))
  : ALL_TOOLS

// Sanity's wording: the item reads "System", its name is "Use system appearance".
const APPEARANCES: [Appearance, string, () => React.JSX.Element][] = [
  ['system', 'System', Desktop],
  ['dark', 'Dark', Moon],
  ['light', 'Light', Sun],
]

/**
 * J63, Sanity's perspective picker: Drafts (what editors work on) or Published,
 * for the whole studio — lists, documents (read-only) and Presentation's preview
 * follow ?perspective=, and links keep it. Releases are plan-gated on the reference,
 * so they are left out.
 */
function PerspectivePicker() {
  const t = useT()
  const navigate = useNavigate()
  const published = usePublishedPerspective()
  const here = useRouterState({select: (s) => s.location.href})
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const pick = (next: 'published' | 'drafts') => {
    close()
    if ((next === 'published') === published) return
    const [path, query = ''] = here.split(/\?(.*)/s)
    const q = new URLSearchParams(query)
    q.set('perspective', next)
    void navigate({href: withPerspective(`${path}?${q}`, false)})
  }
  return (
    <div className="menu-wrap perspective" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button type="button" className="perspective-picker" aria-label={t('Perspective')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${published ? 'published' : 'draft-ring'}`} aria-hidden="true" />
        <span className="perspective-label">{published ? t('Published') : t('Drafts')}</span>
        <ChevronDown />
      </button>
      {open && (
        <MenuPopover className="popover menu perspective-menu" onClose={close}>
          <button type="button" role="menuitemradio" aria-checked={published} className="menu-item" autoFocus={published} onClick={() => pick('published')}>
            <span className="menu-icon-text">
              <span className="dot published" aria-hidden="true" /> {t('Published')}
            </span>
          </button>
          <button type="button" role="menuitemradio" aria-checked={!published} className="menu-item" autoFocus={!published} onClick={() => pick('drafts')}>
            <span className="menu-icon-text">
              <span className="dot draft-ring" aria-hidden="true" /> {t('Drafts')}
            </span>
          </button>
        </MenuPopover>
      )}
    </div>
  )
}
