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
