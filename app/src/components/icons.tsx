// Inline 25×25 icons, drawn to match Sanity's icon set.
const s = {width: 25, height: 25, viewBox: '0 0 25 25', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2} as const

export const ChevronRight = () => (
  <svg {...s}>
    <path d="M10.5 7.5l5 5-5 5" />
  </svg>
)
export const Close = () => (
  <svg {...s}>
    <path d="M7.5 7.5l10 10M17.5 7.5l-10 10" />
  </svg>
)
export const DocumentIcon = () => (
  <svg {...s}>
    <path d="M11.5 4.5h7v16h-12v-11l5-5zM11.5 4.5v5h-5" />
  </svg>
)
export const Search = () => (
  <svg {...s}>
    <circle cx="11.5" cy="11.5" r="5" />
    <path d="M15 15l4.5 4.5" />
  </svg>
)
export const ChevronDown = () => (
  <svg {...s}>
    <path d="M7.5 10.5l5 5 5-5" />
  </svg>
)
export const Ellipsis = () => (
  <svg {...s} fill="currentColor" stroke="none">
    <circle cx="6.5" cy="12.5" r="1.25" />
    <circle cx="12.5" cy="12.5" r="1.25" />
    <circle cx="18.5" cy="12.5" r="1.25" />
  </svg>
)
export const Add = () => (
  <svg {...s}>
    <path d="M12.5 6v13M6 12.5h13" />
  </svg>
)
export const ErrorOutline = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M12.5 8.5v5M12.5 15.5v1" />
  </svg>
)
