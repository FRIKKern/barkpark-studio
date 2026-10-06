import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Link, useNavigate} from '@tanstack/react-router'
import {devSignOut, meQuery} from '../lib/session'
import {GlobalSearch} from './Search'
import {WhoIsOnline} from './Presence'
import {MenuPopover} from './FocusScopes'
import {Desktop, Moon, SignOut, Sun, UserCircle as UserIcon} from './icons'
import {setAppearance, useAppearance, type Appearance} from '../lib/theme'
import {useState} from 'react'
import {useHydratedMark} from '../lib/hydrated'

export function Navbar() {
  useHydratedMark()
  return (
    <nav className="navbar">
      <div className="brand">
        <span className="logo">B</span>
        Barkpark Studio
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
        <Editor />
      </div>
    </nav>
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
] as const

// Sanity's wording: the item reads "System", its name is "Use system appearance".
const APPEARANCES: [Appearance, string, () => React.JSX.Element][] = [
  ['system', 'System', Desktop],
  ['dark', 'Dark', Moon],
  ['light', 'Light', Sun],
]
