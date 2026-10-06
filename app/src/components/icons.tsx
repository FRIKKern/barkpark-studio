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
export const Undo = () => (
  <svg {...s}>
    <path d="M9.5 8.5l-4 4 4 4M5.5 12.5h9a4 4 0 010 8h-2" />
  </svg>
)
export const Users = () => (
  <svg {...s}>
    <circle cx="10" cy="9.5" r="3" />
    <path d="M4.5 19c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5M15.5 6.75a3 3 0 0 1 0 5.5M17.5 14.75c1.6.5 2.7 1.9 3 4.25" />
  </svg>
)
export const ImageIcon = () => (
  <svg {...s}>
    <path d="M5.5 6.5h14v12h-14zM5.5 15.5l4-4 3 3 2-2 5 5" />
    <circle cx="15.5" cy="10" r="1.5" />
  </svg>
)
export const Crop = () => (
  <svg {...s}>
    <path d="M8.5 4.5v12h12M4.5 8.5h12v12" />
  </svg>
)
export const Upload = () => (
  <svg {...s}>
    <path d="M12.5 15.5v-10M8 10l4.5-4.5L17 10M5.5 15.5v4h14v-4" />
  </svg>
)
export const Download = () => (
  <svg {...s}>
    <path d="M12.5 5.5v10M8 11l4.5 4.5L17 11M5.5 15.5v4h14v-4" />
  </svg>
)
export const LinkIcon = () => (
  <svg {...s}>
    <path d="M11 14l3-3M10 9.5l1.8-1.8a3 3 0 014.2 4.2L14.2 13.7M15 15.5l-1.8 1.8A3 3 0 019 13.1l1.8-1.8" />
  </svg>
)
export const Reset = () => (
  <svg {...s}>
    <path d="M6.5 8.5h12M10.5 8.5v-2h4v2M8 8.5l1 11h7l1-11" />
  </svg>
)
export const UserCircle = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="8" />
    <circle cx="12.5" cy="10.5" r="2.5" />
    <path d="M7.5 18.5c1.2-2 2.9-3 5-3s3.8 1 5 3" />
  </svg>
)
