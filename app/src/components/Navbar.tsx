import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Link, useNavigate} from '@tanstack/react-router'
import {devSignOut, meQuery} from '../lib/session'
import {GlobalSearch} from './Search'
import {ScopeSwitcher} from './ScopeSwitcher'
import {WhoIsOnline} from './Presence'
import {DialogBox, MenuPopover} from './FocusScopes'
import {Close, Desktop, HelpCircle, MenuIcon, Moon, SignOut, Sun, UserCircle as UserIcon} from './icons'
import {setAppearance, useAppearance, type Appearance} from '../lib/theme'
import {useState} from 'react'
import {useHydratedMark} from '../lib/hydrated'
import {BUILD, buildName, useNewVersion} from '../lib/version'
import {saveAll} from '../lib/edits'

export function Navbar() {
  useHydratedMark()
  return (
    <nav className="navbar">
      <div className="brand">
        <NavDrawer />
        <span className="logo">B</span>
        <span className="brand-name">Barkpark Studio</span>
        <ScopeSwitcher />
        <GlobalSearch />
      </div>
      {/* J37: Sanity's tool switcher. The active tool is the highlighted tab. */}
      <div className="tools">
        {TOOLS.map(([to, label]) => (
          <Link key={to} to={to} className="tool" activeProps={{className: 'tool tab', 'aria-current': 'page'}}>
            {label}
          </Link>
        ))}
      </div>
      <div className="nav-right">
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
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const appearance = useAppearance()
  const [open, setOpen] = useState(false)
  const signedIn = !!(me?.devLogin && me.email)
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className="icon-btn nav-drawer-btn" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MenuIcon />
      </button>
      {open && (
        <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <DialogBox className="nav-drawer" aria-modal="true" aria-label="Menu" onClose={close}>
            <header>
              {signedIn ? <span className="user-initial">{me!.email![0]!.toUpperCase()}</span> : <span className="logo">B</span>}
              <span className="drawer-who">{signedIn ? me!.email : 'Barkpark Studio'}</span>
              <button type="button" className="icon-btn" aria-label="Close menu" onClick={close}>
                <Close />
              </button>
            </header>
            <nav aria-label="Tools">
              {TOOLS.map(([to, label]) => (
                <Link key={to} to={to} className="drawer-item" activeProps={{className: 'drawer-item on', 'aria-current': 'page'}} onClick={close}>
                  {label}
                </Link>
              ))}
            </nav>
            <div className="drawer-foot">
              {APPEARANCES.map(([a, label, Icon]) => (
                <button key={a} type="button" aria-pressed={appearance === a} aria-label={`Use ${a} appearance`} className="drawer-item check" onClick={() => setAppearance(a)}>
                  <span className="menu-icon-text">
                    <Icon /> {label}
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
                      await devSignOut()
                      qc.clear()
                      await navigate({to: '/login', search: {redirect: '/structure'}})
                    }}
                  >
                    <span className="menu-icon-text">
                      Sign out <SignOut />
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
 * J53, Sanity's "Help and resources" (top right): a dot on the button when a new
 * Studio version is out; the Studio item names this build and, when the server
 * runs a newer one, reads "Reload to update to …" and reloads once every waiting
 * edit is saved. Sanity's other entries become ours: report a problem, the docs.
 */
function Help() {
  const next = useNewVersion()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reloading, setReloading] = useState(false)
  const reload = async () => {
    setReloading(true)
    await saveAll(qc)
    location.reload()
  }
  return (
    <div className="menu-wrap help" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button
        id="help-menu"
        type="button"
        className="icon-btn"
        aria-label="Help and resources"
        title={next ? 'New version available' : 'Help and resources'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <HelpCircle />
        {next && <span className="update-dot" aria-hidden="true" />}
      </button>
      {open && (
        <MenuPopover className="popover menu help-menu" onClose={() => setOpen(false)} aria-labelledby="help-menu">
          <a role="menuitem" className="menu-item" href="https://github.com/FRIKKern/barkpark-studio/issues/new/choose" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            Report a problem
          </a>
          <hr />
          <button type="button" role="menuitem" className="menu-item studio-version" disabled={!next || reloading} data-update={next ? '' : undefined} onClick={reload}>
            <span className="version-text">
              <span>Barkpark Studio</span>
              <span className="muted">{reloading ? 'Saving, then reloading…' : next ? (buildName(next) === buildName(BUILD) ? 'Reload to update' : `Reload to update to ${buildName(next)}`) : 'Up to date'}</span>
            </span>
            <span className="version-badge">{buildName(BUILD)}</span>
          </button>
          <hr />
          <a role="menuitem" className="menu-item" href="https://github.com/FRIKKern/barkpark-studio#readme" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            Documentation
          </a>
        </MenuPopover>
      )}
    </div>
  )
}

/**
 * The user menu (Sanity's, top right): who you are, the appearance (J45: System,
 * Dark, Light, checked like radios) and, for dev sign-in, Sign out.
 */
function Editor() {
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const appearance = useAppearance()
  const [open, setOpen] = useState(false)
  const signedIn = !!(me?.devLogin && me.email)
  const choose = (a: Appearance) => () => (setAppearance(a), setOpen(false))
  return (
    <div className="editor">
      {signedIn && (
        <span className="dev-badge" title="Dev sign-in: identity is asserted, not proven">
          DEV
        </span>
      )}
      <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
        <button id="user-menu" type="button" className="icon-btn user-btn" aria-label="Open user menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {signedIn ? <span className="user-initial">{me!.email![0]!.toUpperCase()}</span> : <UserIcon />}
        </button>
        {open && (
          <MenuPopover className="popover menu user-menu" onClose={() => setOpen(false)} aria-labelledby="user-menu">
            <div className="user-head">{signedIn ? me!.email : 'Barkpark Studio'}</div>
            <hr />
            {APPEARANCES.map(([a, label, Icon]) => (
              <button key={a} type="button" role="menuitemradio" aria-checked={appearance === a} aria-label={`Use ${a} appearance`} className="menu-item check" onClick={choose(a)}>
                <span className="menu-icon-text">
                  <Icon /> {label}
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
                    await devSignOut()
                    qc.clear()
                    await navigate({to: '/login', search: {redirect: '/structure'}})
                  }}
                >
                  <span className="menu-icon-text">Sign out</span>
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

const TOOLS = [
  ['/structure', 'Structure'],
  ['/vision', 'Vision'],
  ['/media', 'Media'],
] as const

// Sanity's wording: the item reads "System", its name is "Use system appearance".
const APPEARANCES: [Appearance, string, () => React.JSX.Element][] = [
  ['system', 'System', Desktop],
  ['dark', 'Dark', Moon],
  ['light', 'Light', Sun],
]
