import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {devSignOut, meQuery} from '../lib/session'
import {GlobalSearch} from './Search'

export function Navbar() {
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
      <Editor />
    </nav>
  )
}

function Editor() {
  const {data: me} = useQuery(meQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  if (!me?.devLogin || !me.email) return <div />
  return (
    <div className="editor">
      <span className="dev-badge" title="Dev sign-in: identity is asserted, not proven">DEV</span>
      <span>{me.email}</span>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          await devSignOut()
          qc.clear()
          await navigate({to: '/login', search: {redirect: '/structure'}})
        }}
      >
        Sign out
      </button>
    </div>
  )
}
