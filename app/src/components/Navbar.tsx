import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {devSignOut, meQuery} from '../lib/session'
import {GlobalSearch} from './Search'
import {WhoIsOnline} from './Presence'
import {MenuPopover} from './FocusScopes'
import {UserCircle as UserIcon} from './icons'
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
      <div>
        <span className="tab">Structure</span>
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
            {APPEARANCES.map(([a, label]) => (
              <button key={a} type="button" role="menuitemradio" aria-checked={appearance === a} className="menu-item" onClick={choose(a)}>
                <span className="check">{appearance === a ? '✓' : ''}</span> {label}
              </button>
            ))}
            {signedIn && (
              <>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={async () => {
                    setOpen(false)
                    await devSignOut()
                    qc.clear()
                    await navigate({to: '/login', search: {redirect: '/structure'}})
                  }}
                >
                  Sign out
                </button>
              </>
            )}
          </MenuPopover>
        )}
      </div>
    </div>
  )
}

const APPEARANCES: [Appearance, string][] = [
  ['system', 'Use system appearance'],
  ['dark', 'Use dark appearance'],
  ['light', 'Use light appearance'],
]
