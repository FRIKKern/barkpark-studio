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
      <div />
    </nav>
  )
}
