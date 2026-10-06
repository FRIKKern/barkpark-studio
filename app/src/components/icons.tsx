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
export const ChevronLeft = () => (
  <svg {...s}>
    <path d="M14.5 7.5l-5 5 5 5" />
  </svg>
)
export const Calendar = () => (
  <svg {...s}>
    <rect x="5.5" y="6.5" width="14" height="13" rx="1" />
    <path d="M5.5 10.5h14M9.5 4.5v4M15.5 4.5v4" />
  </svg>
)
export const Clock = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M12.5 8.5v4l3 2" />
  </svg>
)
export const ClearCircle = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M10 10l5 5M15 10l-5 5" />
  </svg>
)
export const HelpCircle = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M10.5 10.5a2 2 0 1 1 2.75 1.85c-.5.2-.75.6-.75 1.15v.5M12.5 15.5v1" />
  </svg>
)
export const SplitVertical = () => (
  <svg {...s}>
    <path d="M5.5 6.5h14v12h-14zM12.5 6.5v12M15 11h2.5M16.25 9.75v2.5" />
  </svg>
)
export const Share = () => (
  <svg {...s}>
    <path d="M12.5 15.5v-11M8.5 8.5l4-4 4 4M6.5 12.5v7h12v-7" />
  </svg>
)
export const DragHandle = () => (
  <svg {...s} fill="currentColor" stroke="none">
    <circle cx="10" cy="7.5" r="1.1" />
    <circle cx="15" cy="7.5" r="1.1" />
    <circle cx="10" cy="12.5" r="1.1" />
    <circle cx="15" cy="12.5" r="1.1" />
    <circle cx="10" cy="17.5" r="1.1" />
    <circle cx="15" cy="17.5" r="1.1" />
  </svg>
)
