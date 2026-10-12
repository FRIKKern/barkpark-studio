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
/** Sanity's BinaryDocumentIcon: a file field's file. */
export const BinaryDocumentIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M11.5 4.5V9.5H6.5" />
    <path strokeLinecap="square" d="M9.5 12.5V17.5M11.5 4.5H18.5V20.5H6.5V9.5L11.5 4.5ZM12.5 12.5V17.5H15.5V12.5H12.5Z" />
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
export const ChevronUp = () => (
  <svg {...s}>
    <path d="M17.5 14.5l-5-5-5 5" />
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
/** Sanity's reset icon: a select list's "Clear", an x in a circling arrow. */
export const ResetCircle = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M7 11L4.56189 13.5L2 11" />
    <path d="M9.50001 15.5L15.5 9.5M9.5 9.5L15.5 15.5M4.56189 13.5C4.52104 13.1724 4.5 12.8387 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C9.75033 20.5 7.32466 19.1128 5.88468 17" />
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
/** An image that can't be shown (an asset value from elsewhere): the image icon, struck through. */
export const BrokenImageIcon = () => (
  <svg {...s}>
    <path d="M5.5 6.5h14v12h-14zM5.5 15.5l4-4 3 3 2-2 5 5M4.5 20.5l16-16" />
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
/** Sanity's UlistIcon: an array field. */
export const ListIcon = () => (
  <svg {...s}>
    <path d="M10 7.5H19M10 17.5H19M10 12.5H19" />
    <circle cx="6.5" cy="7.5" r="0.6" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r="0.6" fill="currentColor" />
    <circle cx="6.5" cy="17.5" r="0.6" fill="currentColor" />
  </svg>
)
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
/** Sanity's CommentIcon: a speech bubble. */
export const CommentIcon = () => (
  <svg {...s}>
    <path d="M6.5 7.5h12v8h-7l-3 3v-3h-2z" strokeLinejoin="round" />
  </svg>
)
/** Sanity's AddCommentIcon: a speech bubble with a plus. */
export const AddComment = () => (
  <svg {...s}>
    <path d="M13.5 7.5h-7v8h2v3l3-3h7v-4" strokeLinejoin="round" />
    <path d="M18.5 4.5v6M15.5 7.5h6" />
  </svg>
)
/** Sanity's ArrowRightIcon-like send arrow (the comment Send button). */
/** An "@": mention a user (J40). */
export const Mention = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="3" />
    <path d="M15.5 9.5v4.25a1.75 1.75 0 0 0 3.5 0V12.5a6.5 6.5 0 1 0-2.6 5.2" strokeLinecap="round" />
  </svg>
)
export const Send = () => (
  <svg {...s}>
    <path d="M6.5 6.5l13 6-13 6 2-6zM8.5 12.5h11" strokeLinejoin="round" />
  </svg>
)
/** Sanity's ToggleArrowRightIcon: the filled triangle on a collapsible object (J14). */
export const ToggleArrowRight = () => (
  <svg {...s}>
    <path d="M10.5 16.5V8.5L15.5 12.5L10.5 16.5Z" fill="currentColor" stroke="none" />
  </svg>
)
/** Sanity's CodeBlockIcon-like braces (Inspect). */
export const Braces = () => (
  <svg {...s}>
    <path d="M10.5 6.5h-1a2 2 0 00-2 2v2l-1.5 2 1.5 2v2a2 2 0 002 2h1M14.5 6.5h1a2 2 0 012 2v2l1.5 2-1.5 2v2a2 2 0 01-2 2h-1" />
  </svg>
)
/** Sanity's ClipboardIcon (Paste document). */
export const ClipboardIcon = () => (
  <svg {...s}>
    <path d="M9.5 5.5h6v2h-6zM9.5 6.5h-2v13h11v-13h-2" strokeLinejoin="round" />
  </svg>
)
/** Sanity's CheckmarkCircleIcon (the validation button when only infos are left). */
export const CheckmarkCircle = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M9.5 12.5l2 2 4-4" />
  </svg>
)
/** Sanity's ReadOnlyIcon (the permission banner, J49). */
export const ReadOnlyIcon = () => (
  <svg {...s}>
    <path d="M15 7L18 10M10 12L7 15L6 19L10 18L13 15M12 10L17 5L20 8L15 13M19 19L5 5" strokeLinejoin="round" />
  </svg>
)
/** Sanity's PublishIcon (the footer's Publish button). */
export const PublishIcon = () => (
  <svg {...s}>
    <path d="M5 5.5H20M12.5 9V20" />
    <path d="M7.5 14L12.5 9L17.5 14" strokeLinejoin="round" />
  </svg>
)
/** Sanity's UnpublishIcon (the Published view's red Unpublish). */
export const UnpublishIcon = () => (
  <svg {...s}>
    <path d="M5 19.5H20M12.5 16V5" />
    <path d="M17.5 11L12.5 16L7.5 11" strokeLinejoin="round" />
  </svg>
)
/** Sanity's SyncIcon (the footer's "Saving…", turning). */
export const SyncIcon = () => (
  <svg {...s}>
    <path d="M13.5 4.5H12.5C8.08 4.5 4.5 8.08 4.5 12.5C4.5 15.66 6.34 18.4 9 19.7M11.5 20.5H12.5C16.92 20.5 20.5 16.92 20.5 12.5C20.5 9.34 18.66 6.6 16 5.3" />
    <path d="M14 17.56L11.5 20.5L14.5 23.06M11 7.44L13.5 4.5L10.5 1.94" strokeLinejoin="round" />
  </svg>
)
export const EarthGlobe = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="7" />
    <path d="M5.5 12.5h14M12.5 5.5c-2.5 2.5-2.5 11.5 0 14M12.5 5.5c2.5 2.5 2.5 11.5 0 14" />
  </svg>
)
export const Mobile = () => (
  <svg {...s}>
    <rect x="8.5" y="5.5" width="8" height="14" rx="1" />
    <path d="M11.5 17.5h2" />
  </svg>
)
export const LaunchIcon = () => (
  <svg {...s}>
    <path d="M13.5 6.5h5v5M18.5 6.5l-7 7M11.5 7.5h-5v11h11v-5" />
  </svg>
)
/** Sanity's TransferIcon: Compare versions (J68). */
export const Transfer = () => (
  <svg {...s}>
    <path d="M19.5 16.5H6M5.5 8.5L19 8.5" />
    <path d="M16 13L19.5 16.5L16 20M9 12L5.5 8.5L9 5" />
  </svg>
)
// The rich text toolbar's marks and lists (J10), Sanity's icons.
const filled = {fill: 'currentColor', stroke: 'none'} as const
export const BoldIcon = () => (
  <svg {...s}>
    <path {...filled} d="M13.2087 18C15.5322 18 16.9731 16.793 16.9731 14.8844C16.9731 13.4812 15.9245 12.3949 14.4836 12.2892V12.1534C15.6001 11.9875 16.4526 10.9841 16.4526 9.82991C16.4526 8.14761 15.1927 7.11409 13.0804 7.11409H8.32019V18H13.2087ZM10.5985 8.85674H12.4995C13.5859 8.85674 14.212 9.37727 14.212 10.2448C14.212 11.1199 13.5406 11.6254 12.3109 11.6254H10.5985V8.85674ZM10.5985 16.2574V13.1643H12.575C13.9178 13.1643 14.6496 13.6924 14.6496 14.6882C14.6496 15.7066 13.9404 16.2574 12.6278 16.2574H10.5985Z" />
  </svg>
)
export const ItalicIcon = () => (
  <svg {...s}>
    <path {...filled} d="M10.43 18H11.7276L13.4551 9.86763H12.1576L10.43 18ZM13.3042 8.29849C13.8021 8.29849 14.2095 7.89112 14.2095 7.39322C14.2095 6.89532 13.8021 6.48795 13.3042 6.48795C12.8063 6.48795 12.399 6.89532 12.399 7.39322C12.399 7.89112 12.8063 8.29849 13.3042 8.29849Z" />
  </svg>
)
export const CodeIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M11 16L7.5 12.5L11 9M14 9L17.5 12.5L14 16" />
  </svg>
)
export const UnderlineIcon = () => (
  <svg {...s}>
    <path {...filled} d="M9.52791 7.11407H8.17V14.2582C8.17 16.5817 9.79195 18.2565 12.4927 18.2565C15.1934 18.2565 16.8154 16.5817 16.8154 14.2582V7.11407H15.4574V14.1677C15.4574 15.8122 14.3787 17.0042 12.4927 17.0042C10.6067 17.0042 9.52791 15.8122 9.52791 14.1677V7.11407Z" />
    <path d="M7 20.5H18" />
  </svg>
)
export const StrikeIcon = () => (
  <svg {...s}>
    <path {...filled} d="M12.5656 7.73438C11.0656 7.73438 10.0734 8.48438 10.0734 9.625C10.0734 10.2317 10.3649 10.6613 11.0519 11H8.90358C8.71703 10.6199 8.62813 10.1801 8.62813 9.67188C8.62813 7.75781 10.2297 6.46094 12.6125 6.46094C14.7922 6.46094 16.4172 7.75781 16.5344 9.57812H15.1203C14.925 8.42188 13.9719 7.73438 12.5656 7.73438Z" />
    <path {...filled} d="M12.4875 18.2656C10.0969 18.2656 8.44844 17 8.3 15.0547H9.72188C9.89375 16.2344 11.0188 16.9844 12.6203 16.9844C14.1359 16.9844 15.2531 16.1641 15.2531 15.0469C15.2531 14.6375 15.1255 14.292 14.8589 14H16.5912C16.6638 14.266 16.6984 14.5566 16.6984 14.875C16.6984 16.9453 15.0656 18.2656 12.4875 18.2656Z" />
    <path {...filled} d="M7 13.1H18V11.9H7V13.1Z" />
  </svg>
)
export const UlistIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M7.10153 17.5C7.10153 17.8322 6.83221 18.1016 6.5 18.1016C6.16778 18.1016 5.89847 17.8322 5.89847 17.5C5.89847 17.1678 6.16778 16.8985 6.5 16.8985C6.83221 16.8985 7.10153 17.1678 7.10153 17.5Z" />
    <path d="M7.10153 7.49997C7.10153 7.83218 6.83221 8.1015 6.5 8.1015C6.16778 8.1015 5.89847 7.83218 5.89847 7.49997C5.89847 7.16775 6.16778 6.89844 6.5 6.89844C6.83221 6.89844 7.10153 7.16775 7.10153 7.49997Z" />
    <path d="M7.10153 12.5C7.10153 12.8322 6.83221 13.1015 6.5 13.1015C6.16778 13.1015 5.89847 12.8322 5.89847 12.5C5.89847 12.1678 6.16778 11.8984 6.5 11.8984C6.83221 11.8984 7.10153 12.1678 7.10153 12.5Z" />
    <path d="M10 7.5H19M10 17.5H19M10 12.5H19" />
  </svg>
)
export const OlistIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M10 7.5H19M10 12.5H19M10 17.5H19M5 18.5H7.5L7 17.5L7.5 16.5H5M5 6.5H6.5V8.5M5 8.5H6.5M6.5 8.5H8M8 13.5H6L7 11.5H5" />
  </svg>
)
/** Sanity's BlockElementIcon: an inserted block object (a callout). */
export const BlockIcon = () => (
  <svg {...s}>
    <path d="M5 19.5H20M5 5.5H20M6.5 8.5H18.5V16.5H6.5V8.5Z" />
  </svg>
)
