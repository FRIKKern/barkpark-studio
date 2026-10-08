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
export const Expand = () => (
  <svg {...s}>
    <path d="M14.5 5.5h5v5M19.5 5.5l-6 6M10.5 19.5h-5v-5M5.5 19.5l6-6" />
  </svg>
)
export const Collapse = () => (
  <svg {...s}>
    <path d="M13.5 6.5v5h5M13.5 11.5l6-6M11.5 18.5v-5h-5M11.5 13.5l-6 6" />
  </svg>
)
export const Sync = () => (
  <svg {...s}>
    <path d="M13.5 4.5H12.5C8.08172 4.5 4.5 8.08172 4.5 12.5C4.5 15.6631 6.33576 18.3975 9 19.6958M11.5 20.5H12.5C16.9183 20.5 20.5 16.9183 20.5 12.5C20.5 9.33688 18.6642 6.60253 16 5.30423" />
    <path d="M14 17.5619L11.5 20.5L14.5 23.0619M11 7.43811L13.5 4.50001L10.5 1.93811" />
  </svg>
)
export const Copy = () => (
  <svg {...s}>
    <path d="M8.5 8.5H5.5V20.5H16.5V16.5M19.5 4.5H8.5V16.5H19.5V4.5Z" />
  </svg>
)
export const ArrowLeft = () => (
  <svg {...s}>
    <path d="M5.5 12.5H20M11 18L5.5 12.5L11 7" />
  </svg>
)
export const WarningOutline = () => (
  <svg {...s}>
    <path d="M12.5 5.5l7 13h-14z" strokeLinejoin="round" />
    <path d="M12.5 10.5v4M12.5 16v1" />
  </svg>
)
export const Desktop = () => (
  <svg {...s}>
    <rect x="5.5" y="6.5" width="14" height="9" rx="1" />
    <path d="M10 19.5h5M12.5 15.5v4" />
  </svg>
)
export const Moon = () => (
  <svg {...s}>
    <path d="M18.5 14.5a6.5 6.5 0 01-8-8 6.5 6.5 0 108 8z" strokeLinejoin="round" />
  </svg>
)
export const Sun = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="3" />
    <path d="M12.5 5v2M12.5 18v2M5 12.5h2M18 12.5h2M7.2 7.2l1.4 1.4M16.4 16.4l1.4 1.4M7.2 17.8l1.4-1.4M16.4 8.6l1.4-1.4" />
  </svg>
)
export const SignOut = () => (
  <svg {...s}>
    <path d="M14.5 8.5v-2h-8v12h8v-2M11 12.5h9M17 9.5l3 3-3 3" strokeLinejoin="round" />
  </svg>
)
export const TagIcon = () => (
  <svg {...s}>
    <path d="M12.5 5.5h7v7l-8 8-7-7 8-8z" />
    <circle cx="16" cy="9" r="1" />
  </svg>
)
export const Check = () => (
  <svg {...s}>
    <path d="M5.5 12.5l5 5 9-9" />
  </svg>
)
/** Sanity's SortIcon: a down arrow and an up arrow side by side. */
export const Sort = () => (
  <svg {...s}>
    <path d="M8.5 6.5v12M5.5 15.5l3 3 3-3M16.5 18.5v-12M13.5 9.5l3-3 3 3" />
  </svg>
)
/** Sanity's ControlsIcon: three sliders (the search "Show filters" toggle). */
export const Controls = () => (
  <svg {...s}>
    <path d="M7.5 5.5v14M12.5 5.5v14M17.5 5.5v14M5.5 9.5h4M10.5 15.5h4M15.5 11.5h4" />
  </svg>
)
export const Trash = () => (
  <svg {...s}>
    <path d="M6.5 7.5h12M10.5 7.5v-2h4v2M8 7.5l.8 12h7.4l.8-12M11 10.5v6M14 10.5v6" />
  </svg>
)
/** Sanity's StackCompactIcon (list layout: compact). */
export const StackCompact = () => (
  <svg {...s}>
    <path d="M5.5 7.5h14v10h-14zM5.5 10.5h14M5.5 14.5h14" />
  </svg>
)
/** Sanity's StackIcon (list layout: detailed). */
export const Stack = () => (
  <svg {...s}>
    <path d="M5.5 7.5h14v10h-14zM5.5 12.5h14" />
  </svg>
)
/** Sanity's InfoOutlineIcon. */
export const InfoOutline = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M12.5 11v6M12.5 8v1.5" />
  </svg>
)
/** Sanity's MenuIcon (the phone navbar's drawer button). */
export const MenuIcon = () => (
  <svg {...s}>
    <path d="M6 8.5h13M6 12.5h13M6 16.5h13" />
  </svg>
)
