// Inline 25×25 icons, drawn to match Sanity's icon set.
const s = {width: 25, height: 25, viewBox: '0 0 25 25', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2} as const

export const ChevronRight = () => (
  <svg {...solid}>
    <path d="M10 8L14.5 12.5L10 17" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Close = () => (
  <svg {...solid}>
    <path d="M18 7L7 18M7 7L18 18" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's LinkRemovedIcon: an inline comment whose text was deleted. */
export const LinkRemoved = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M18.5 11C19.281 10.219 19.281 8.78108 18.5 8.00003L18 7.50003C17.2189 6.71898 15.781 6.71898 15 7.50003L13 9.50003M15.5 14C14.7189 14.7811 13.281 14.7811 12.5 14M6.5 14C5.71895 14.7811 5.71894 16.219 6.49999 17L6.99999 17.5C7.78104 18.2811 9.21894 18.2811 9.99999 17.5L12 15.5M12.5 11C11.719 10.219 10.281 10.219 9.5 11M3 12.5H22" />
  </svg>
)
/** Sanity's DocumentIcon. */
export const DocumentIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M11.5 4.5V9.5H6.5" />
    <path d="M18.5 20.5H6.5V9.5L11.5 4.5H18.5V20.5Z" />
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
  <svg {...solid}>
    <path d="M15.0355 15.0355L20 20M16.5 11.5C16.5 14.2614 14.2614 16.5 11.5 16.5C8.73858 16.5 6.5 14.2614 6.5 11.5C6.5 8.73858 8.73858 6.5 11.5 6.5C14.2614 6.5 16.5 8.73858 16.5 11.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's ChevronDownIcon. */
export const ChevronDown = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M17 10L12.5 14.5L8 10" />
  </svg>
)
/** Sanity's search filter icons by field kind (its CheckmarkCircleIcon is below): StringIcon, NumberIcon, BlockContentIcon (portable text). */
const solid = {width: 25, height: 25, viewBox: '0 0 25 25', fill: 'none'} as const
export const StringIcon = () => (
  <svg {...solid}>
    <path d="M11.6748 15.5227H13.1855L9.87842 6.36304H8.34863L5.0415 15.5227H6.50146L7.3457 13.0916H10.8369L11.6748 15.5227ZM9.04053 8.02612H9.14844L10.4751 11.8982H7.70752L9.04053 8.02612Z" fill="currentColor" />
    <path d="M16.8101 14.488C16.0674 14.488 15.5278 14.1262 15.5278 13.5042C15.5278 12.8948 15.9595 12.571 16.9116 12.5076L18.6001 12.3997V12.9773C18.6001 13.8342 17.8384 14.488 16.8101 14.488ZM16.4609 15.637C17.3687 15.637 18.124 15.2434 18.5366 14.5515H18.6445V15.5227H19.9585V10.8C19.9585 9.34009 18.981 8.47681 17.248 8.47681C15.6802 8.47681 14.563 9.23853 14.4233 10.4255H15.7437C15.896 9.93677 16.4229 9.65747 17.1846 9.65747C18.1177 9.65747 18.6001 10.0701 18.6001 10.8V11.3967L16.7275 11.5046C15.0835 11.6062 14.1567 12.3235 14.1567 13.5676C14.1567 14.8308 15.1279 15.637 16.4609 15.637Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M19.9585 18.637L5.0415 18.637V17.437L19.9585 17.437V18.637Z" fill="currentColor" />
  </svg>
)
export const NumberIcon = () => (
  <svg {...solid}>
    <path fillRule="evenodd" clipRule="evenodd" d="M21.0165 17.6336H3.83636V16.4336H21.0165V17.6336Z" fill="currentColor" />
    <path d="M7.09808 13.3967V7.508H5.74066L3.83636 8.78241V10.091L5.65277 8.88495H5.74066V13.3967H3.84125V14.5539H8.89984V13.3967H7.09808Z" fill="currentColor" />
    <path d="M9.81781 9.63202V9.66132H11.1069V9.62714C11.1069 8.95331 11.5756 8.49432 12.2739 8.49432C12.9575 8.49432 13.4018 8.89471 13.4018 9.50507C13.4018 9.9787 13.1528 10.3498 12.1909 11.3117L9.89594 13.5822V14.5539H14.8618V13.3869H11.7807V13.299L13.1577 11.9855C14.3491 10.843 14.7543 10.1838 14.7543 9.41229C14.7543 8.19159 13.7729 7.36639 12.3178 7.36639C10.8383 7.36639 9.81781 8.28436 9.81781 9.63202Z" fill="currentColor" />
    <path d="M17.6694 11.4631H18.5092C19.3198 11.4631 19.8422 11.8683 19.8422 12.4982C19.8422 13.1183 19.3295 13.5139 18.5239 13.5139C17.767 13.5139 17.2592 13.133 17.2104 12.5324H15.9262C15.9897 13.8508 17.0248 14.6955 18.5629 14.6955C20.1401 14.6955 21.2192 13.841 21.2192 12.591C21.2192 11.6584 20.6528 11.0334 19.7006 10.9211V10.8332C20.4721 10.6769 20.9457 10.0666 20.9457 9.23651C20.9457 8.12323 19.9741 7.36639 18.5434 7.36639C17.0541 7.36639 16.1118 8.17694 16.0629 9.50018H17.2983C17.3422 8.88007 17.8061 8.48456 18.4995 8.48456C19.2075 8.48456 19.6567 8.85565 19.6567 9.44159C19.6567 10.0324 19.1977 10.4182 18.4946 10.4182H17.6694V11.4631Z" fill="currentColor" />
  </svg>
)
export const BlockContentIcon = () => (
  <svg {...solid}>
    <path fillRule="evenodd" clipRule="evenodd" d="M21 7.60002L11 7.60003V6.40003L21 6.40002V7.60002Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M21 11.2667L12.4833 11.2667V10.0667L21 10.0667V11.2667Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M21 14.9334H13.9254V13.7334L21 13.7334V14.9334Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M21 18.6002H4V17.4002H21V18.6002Z" fill="currentColor" />
    <path d="M9.86438 15.6H11.2L8.27623 7.60003H6.92377L4 15.6H5.29072L6.0371 13.4767H9.12362L9.86438 15.6ZM7.53546 9.05255H7.63086L8.80374 12.4344H6.35698L7.53546 9.05255Z" fill="currentColor" />
  </svg>
)
export const ChevronUp = () => (
  <svg {...solid}>
    <path d="M8 15L12.5 10.5L17 15" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Ellipsis = () => (
  <svg {...solid}>
    <path d="M6.5 11C7.32843 11 8 11.6716 8 12.5C8 13.3284 7.32843 14 6.5 14C5.67157 14 5 13.3284 5 12.5C5 11.6716 5.67157 11 6.5 11Z" fill="currentColor" />
    <path d="M12.5 11C13.3284 11 14 11.6716 14 12.5C14 13.3284 13.3284 14 12.5 14C11.6716 14 11 13.3284 11 12.5C11 11.6716 11.6716 11 12.5 11Z" fill="currentColor" />
    <path d="M18.5 11C19.3284 11 20 11.6716 20 12.5C20 13.3284 19.3284 14 18.5 14C17.6716 14 17 13.3284 17 12.5C17 11.6716 17.6716 11 18.5 11Z" fill="currentColor" />
  </svg>
)
export const Add = () => (
  <svg {...solid}>
    <path d="M12.5 5V20M5 12.5H20" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const ErrorOutline = () => (
  <svg {...solid}>
    <path d="M12.5 16V14.5M12.5 9V13M20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C8.08172 20.5 4.5 16.9183 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const ChevronLeft = () => (
  <svg {...solid}>
    <path d="M15 17L10.5 12.5L15 8" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's CalendarIcon (@sanity/icons 5.2.3). */
export const Calendar = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M5.5 18.5H19.5V6.5H5.5V18.5Z" />
    <path d="M16.5 8V4M8.5 8V4M8 12.5H10M8 15.5H10M11.5 12.5H13.5M11.5 15.5H13.5M15 12.5H17M15 15.5H17M12.5 8V4M5.5 9.5H19.5" />
  </svg>
)
export const Clock = () => (
  <svg {...solid}>
    <path d="M12.5 8V12.5L15.5 15.5M20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C8.08172 20.5 4.5 16.9183 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's LockIcon: a scheduled draft is locked (J40). */
export const LockIcon = () => (
  <svg {...solid}>
    <path d="M15.5 11.5V8.5C15.5 6.5 14 5.5 12.5 5.5C11 5.5 9.5 6.5 9.5 8.5V11.5M7.5 11.5H17.5V19.5H7.5V11.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
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
  <svg {...solid}>
    <path d="M12.5 13C12.5 11 14 11.5 14 10C14 9.34375 13.5 8.5 12.5 8.5C11.5 8.5 11 9 10.5 9.5M12.5 16V14.5M20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C8.08172 20.5 4.5 16.9183 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's SplitVerticalIcon (Split pane right). */
export const SplitVertical = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M10.5 5.5V19.5M13 12.5H15.5M18 12.5H15.5M15.5 12.5V15M15.5 12.5V10M4.5 5.5H20.5V19.5H4.5V5.5Z" />
  </svg>
)
/** Sanity's MasterDetailIcon: the Structure tool's, on Presentation's "Open in Structure". */
export const MasterDetail = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M9.5 6.5V10.5M9.5 10.5V14.5M9.5 10.5H5.5M9.5 14.5V18.5M9.5 14.5H5.5M5.5 6.5H19.5V18.5H5.5V6.5Z" />
  </svg>
)
/** Sanity's RefreshIcon (Presentation's "Refresh preview"). */
export const RefreshIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M19.5 13.5C19.5 17.366 16.366 20.5 12.5 20.5C8.63401 20.5 5.5 17.366 5.5 13.5C5.5 9.63401 8.63401 6.5 12.5 6.5H15.5" />
    <path d="M11.5 10.5L15.5 6.5L11.5 2.5" />
  </svg>
)
/** Sanity's ShareIcon. */
export const Share = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M15 10.5H18.5V19.5H6.5L6.5 10.5H10M12.5 16V3.5" />
    <path d="M9 7L12.5 3.5L16 7" />
  </svg>
)
export const DragHandle = () => (
  <svg {...solid}>
    <path d="M9.5 8C10.3284 8 11 7.32843 11 6.5C11 5.67157 10.3284 5 9.5 5C8.67157 5 8 5.67157 8 6.5C8 7.32843 8.67157 8 9.5 8Z" fill="currentColor" />
    <path d="M9.5 14C10.3284 14 11 13.3284 11 12.5C11 11.6716 10.3284 11 9.5 11C8.67157 11 8 11.6716 8 12.5C8 13.3284 8.67157 14 9.5 14Z" fill="currentColor" />
    <path d="M11 18.5C11 19.3284 10.3284 20 9.5 20C8.67157 20 8 19.3284 8 18.5C8 17.6716 8.67157 17 9.5 17C10.3284 17 11 17.6716 11 18.5Z" fill="currentColor" />
    <path d="M15.5 8C16.3284 8 17 7.32843 17 6.5C17 5.67157 16.3284 5 15.5 5C14.6716 5 14 5.67157 14 6.5C14 7.32843 14.6716 8 15.5 8Z" fill="currentColor" />
    <path d="M17 12.5C17 13.3284 16.3284 14 15.5 14C14.6716 14 14 13.3284 14 12.5C14 11.6716 14.6716 11 15.5 11C16.3284 11 17 11.6716 17 12.5Z" fill="currentColor" />
    <path d="M15.5 20C16.3284 20 17 19.3284 17 18.5C17 17.6716 16.3284 17 15.5 17C14.6716 17 14 17.6716 14 18.5C14 19.3284 14.6716 20 15.5 20Z" fill="currentColor" />
  </svg>
)
export const Undo = () => (
  <svg {...solid}>
    <path d="M6 9.5L15 9.5C17.4853 9.5 19.5 11.5147 19.5 14C19.5 16.4853 17.4853 18.5 15 18.5H6" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M10 13.5L6 9.5L10 5.5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Users = () => (
  <svg {...solid}>
    <path d="M17.5 18.5H21.5C21.5 15 20.8416 14.1708 19.5 13.5C18.5 13 16.5 12.5 16.5 11C16.5 9.5 17.5 9 17.5 7C17.5 5 16.5 4 15 4C13.6628 4 12.723 4.79472 12.5347 6.38415M4.5 20.5C4.5 17 5.5 16 6.5 15.5C7.5 15 9.5 14.5 9.5 13C9.5 11.5 8.5 11 8.5 9C8.5 7 9.5 6 11 6C12.5 6 13.5 7 13.5 9C13.5 11 12.5 11.5 12.5 13C12.5 14.5 14.5 15 15.5 15.5C16.8416 16.1708 17.5 17 17.5 20.5H4.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's ImageIcon. */
export const ImageIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M5.5 15.5L8.79289 12.2071C9.18342 11.8166 9.81658 11.8166 10.2071 12.2071L12.8867 14.8867C13.2386 15.2386 13.7957 15.2782 14.1938 14.9796L15.1192 14.2856C15.3601 14.1049 15.6696 14.0424 15.9618 14.1154L19.5 15M5.5 6.5H19.5V18.5H5.5V6.5ZM15.5 10.5C15.5 11.0523 15.0523 11.5 14.5 11.5C13.9477 11.5 13.5 11.0523 13.5 10.5C13.5 9.94772 13.9477 9.5 14.5 9.5C15.0523 9.5 15.5 9.94772 15.5 10.5Z" />
  </svg>
)
/** An image that can't be shown (an asset value from elsewhere): the image icon, struck through. */
export const BrokenImageIcon = () => (
  <svg {...s}>
    <path d="M5.5 6.5h14v12h-14zM5.5 15.5l4-4 3 3 2-2 5 5M4.5 20.5l16-16" />
  </svg>
)
export const Crop = () => (
  <svg {...solid}>
    <path d="M9.5 5V15.5H20M5 9.5H15.5V20" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Upload = () => (
  <svg {...solid}>
    <path d="M12.5 6V15.5M5.5 15.5H19.5V19.5H5.5V15.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M7.5 11L12.5 6L17.5 11" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Download = () => (
  <svg {...solid}>
    <path d="M19.5 17V19.5H5.5V17M12.5 16L12.5 5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M17.5 11L12.5 16L7.5 11" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's LinkIcon. */
export const LinkIcon = () => (
  <svg {...solid}>
    <path d="M11 12.5L12.5 14C13.281 14.781 14.719 14.781 15.5 14L18.5 11C19.281 10.219 19.281 8.78105 18.5 8L18 7.5C17.2189 6.71895 15.781 6.71895 15 7.5L13 9.5M12 15.5L10 17.5C9.21895 18.281 7.78105 18.281 7 17.5L6.5 17C5.71895 16.219 5.71896 14.781 6.5 14L9.50001 11C10.2811 10.219 11.719 10.2189 12.5 11L14 12.5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's TargetIcon (Copy document ID). */
export const TargetIcon = () => (
  <svg {...solid}>
    <path d="M12.5 3V10M22 12.5H15M12.5 22V15M3 12.5H10M19 12.5C19 16.0899 16.0899 19 12.5 19C8.91015 19 6 16.0899 6 12.5C6 8.91015 8.91015 6 12.5 6C16.0899 6 19 8.91015 19 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Reset = () => (
  <svg {...solid}>
    <path d="M7 11L4.56189 13.5L2 11" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M9.50001 15.5L15.5 9.5M9.5 9.5L15.5 15.5M4.56189 13.5C4.52104 13.1724 4.5 12.8387 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C9.75033 20.5 7.32466 19.1128 5.88468 17" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const UserCircle = () => (
  <svg {...s}>
    <circle cx="12.5" cy="12.5" r="8" />
    <circle cx="12.5" cy="10.5" r="2.5" />
    <path d="M7.5 18.5c1.2-2 2.9-3 5-3s3.8 1 5 3" />
  </svg>
)
/** Sanity's ExpandIcon (focus mode). */
export const Expand = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M14 6.5H18.5V11M11 18.5H6.5V14" />
    <path d="M18.5 6.5L14 11M6.5 18.5L11 14" />
  </svg>
)
/** Sanity's CollapseIcon (leave focus mode). */
export const Collapse = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M6 14.5L10.5 14.5V19M19 10.5H14.5L14.5 6" />
    <path d="M10.5 14.5L6 19M14.5 10.5L19 6" />
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
  <svg {...solid}>
    <path d="M5.5 12.5H20" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M11 18L5.5 12.5L11 7" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const WarningOutline = () => (
  <svg {...solid}>
    <path d="M12.5 9V13M12.5 16V14.5M14.2239 5.43058L20.727 16.486C21.5113 17.8192 20.55 19.5 19.0032 19.5H5.99683C4.45 19.5 3.48869 17.8192 4.27297 16.486L10.7761 5.43058C11.5494 4.11596 13.4506 4.11596 14.2239 5.43058Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's DesktopIcon. */
export const Desktop = () => (
  <svg {...solid}>
    <path d="M4.5 13.5V15.5C4.5 16.0523 4.94772 16.5 5.5 16.5H12.5M4.5 13.5V6.5C4.5 5.94772 4.94772 5.5 5.5 5.5H19.5C20.0523 5.5 20.5 5.94772 20.5 6.5V13.5M4.5 13.5H20.5M20.5 13.5V15.5C20.5 16.0523 20.0523 16.5 19.5 16.5H12.5M12.5 16.5V19.5M12.5 19.5H8M12.5 19.5H17" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Moon = () => (
  <svg {...solid}>
    <path d="M19.6065 16.1775C18.9417 16.387 18.234 16.5 17.5 16.5C13.634 16.5 10.5 13.366 10.5 9.5C10.5 7.54163 11.3042 5.77109 12.6004 4.50062C12.567 4.50021 12.5335 4.5 12.5 4.5C8.08172 4.5 4.5 8.08172 4.5 12.5C4.5 16.9183 8.08172 20.5 12.5 20.5C15.5924 20.5 18.275 18.7454 19.6065 16.1775Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Sun = () => (
  <svg {...solid}>
    <path d="M19 12.5H22M3 12.5H6M12.5 6V3M12.5 22V19M17.3891 7.61091L19.5104 5.48959M5.48959 19.5104L7.61091 17.3891M7.61091 7.61091L5.48959 5.48959M19.5104 19.5104L17.3891 17.3891M16 12.5C16 14.433 14.433 16 12.5 16C10.567 16 9 14.433 9 12.5C9 10.567 10.567 9 12.5 9C14.433 9 16 10.567 16 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const SignOut = () => (
  <svg {...solid}>
    <path d="M14.5 15V18.5H5.5V6.5H14.5V10M9 12.5H21.5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M18 9L21.5 12.5L18 16" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const TagIcon = () => (
  <svg {...solid}>
    <path d="M12.5 20L5 20L5 12.5L12.5 5L20 12.5L12.5 20Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M11 15.5C11 16.3284 10.3284 17 9.5 17C8.67157 17 8 16.3284 8 15.5C8 14.6716 8.67157 14 9.5 14C10.3284 14 11 14.6716 11 15.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Check = () => (
  <svg {...solid}>
    <path d="M5.5 11.5L10.5 16.5L19.5 7.60001" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's SortIcon: a down arrow and an up arrow side by side. */
export const Sort = () => (
  <svg {...solid}>
    <path d="M8.5 18.5V6M16.5 19V6.5M12 15L8.5 18.5L5 15M13 10L16.5 6.5L20 10" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's ControlsIcon: three sliders (the search "Show filters" toggle). */
export const Controls = () => (
  <svg {...solid}>
    <path d="M6.5 5V7.5M6.5 7.5C5.39543 7.5 4.5 8.39543 4.5 9.5C4.5 10.6046 5.39543 11.5 6.5 11.5M6.5 7.5C7.60457 7.5 8.5 8.39543 8.5 9.5C8.5 10.6046 7.60457 11.5 6.5 11.5M6.5 11.5V20M12.5 5V13.5M12.5 13.5C11.3954 13.5 10.5 14.3954 10.5 15.5C10.5 16.6046 11.3954 17.5 12.5 17.5M12.5 13.5C13.6046 13.5 14.5 14.3954 14.5 15.5C14.5 16.6046 13.6046 17.5 12.5 17.5M12.5 17.5V20M18.5 5V7.5M18.5 7.5C17.3954 7.5 16.5 8.39543 16.5 9.5C16.5 10.6046 17.3954 11.5 18.5 11.5M18.5 7.5C19.6046 7.5 20.5 8.39543 20.5 9.5C20.5 10.6046 19.6046 11.5 18.5 11.5M18.5 11.5V20" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's TrashIcon. */
export const Trash = () => (
  <svg {...solid}>
    <path d="M5 6.5H20M10 6.5V4.5C10 3.94772 10.4477 3.5 11 3.5H14C14.5523 3.5 15 3.94772 15 4.5V6.5M12.5 9V17M15.5 9L15 17M9.5 9L10 17M18.5 6.5L17.571 18.5767C17.5309 19.0977 17.0965 19.5 16.574 19.5H8.42603C7.90349 19.5 7.46905 19.0977 7.42898 18.5767L6.5 6.5H18.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
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
  <svg {...solid}>
    <path d="M5.5 15.5V18.5H19.5V15.5M5.5 15.5H19.5M5.5 15.5V9.5M19.5 15.5V9.5M5.5 9.5V6.5H19.5V9.5M5.5 9.5H19.5M5.5 12.5H19.5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's StackIcon (list layout: detailed). */
export const Stack = () => (
  <svg {...solid}>
    <path d="M5.5 12.5H19.5M5.5 18.5H19.5V6.5H5.5V18.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's InfoOutlineIcon. */
export const InfoOutline = () => (
  <svg {...solid}>
    <path d="M12.5 10.5V9M12.5 12V16M20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C8.08172 20.5 4.5 16.9183 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's MenuIcon (the phone navbar's drawer button). */
export const MenuIcon = () => (
  <svg {...solid}>
    <path d="M6 7.5H19M6 17.5H19M6 12.5H19" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's CommentIcon: a speech bubble. */
/** Sanity's BugIcon (Help > Diagnostics): a beetle, legs out. */
export const BugIcon = () => (
  <svg {...solid}>
    <path d="M8.5 9.5V8.9C8.16863 8.9 7.9 9.16863 7.9 9.5H8.5ZM16.5 9.5H17.1C17.1 9.16863 16.8314 8.9 16.5 8.9V9.5ZM8.5 10.1H9.5V8.9H8.5V10.1ZM9.5 10.1H15.5V8.9H9.5V10.1ZM15.5 10.1H16.5V8.9H15.5V10.1ZM15.9 9.5V13.5H17.1V9.5H15.9ZM15.9 13.5C15.9 14.395 15.678 15.0264 15.3758 15.4797C15.0711 15.9367 14.6605 16.2489 14.2317 16.4633C13.8005 16.6789 13.3621 16.7897 13.0264 16.8457C12.8599 16.8734 12.7226 16.887 12.6291 16.8937C12.5825 16.897 12.5472 16.8986 12.5249 16.8994C12.5138 16.8997 12.506 16.8999 12.5018 16.9C12.4997 16.9 12.4984 16.9 12.4981 16.9C12.498 16.9 12.4981 16.9 12.4984 16.9C12.4985 16.9 12.4987 16.9 12.499 16.9C12.4991 16.9 12.4994 16.9 12.4995 16.9C12.4997 16.9 12.5 16.9 12.5 17.5C12.5 18.1 12.5003 18.1 12.5006 18.1C12.5008 18.1 12.5011 18.1 12.5014 18.1C12.5019 18.1 12.5025 18.1 12.5031 18.1C12.5044 18.1 12.5059 18.1 12.5077 18.1C12.5112 18.0999 12.5157 18.0999 12.5212 18.0998C12.532 18.0996 12.5467 18.0993 12.5649 18.0987C12.6013 18.0975 12.6519 18.0951 12.7146 18.0907C12.8399 18.0817 13.0151 18.0641 13.2236 18.0293C13.6379 17.9603 14.1995 17.8211 14.7683 17.5367C15.3395 17.2511 15.9289 16.8133 16.3742 16.1453C16.822 15.4736 17.1 14.605 17.1 13.5H15.9ZM12.5 17.5C12.5 16.9 12.5003 16.9 12.5005 16.9C12.5006 16.9 12.5009 16.9 12.501 16.9C12.5013 16.9 12.5015 16.9 12.5016 16.9C12.5019 16.9 12.502 16.9 12.5019 16.9C12.5016 16.9 12.5003 16.9 12.4982 16.9C12.494 16.8999 12.4862 16.8997 12.4751 16.8994C12.4528 16.8986 12.4175 16.897 12.3709 16.8937C12.2774 16.887 12.1401 16.8734 11.9736 16.8457C11.6379 16.7897 11.1995 16.6789 10.7683 16.4633C10.3395 16.2489 9.92894 15.9367 9.62423 15.4797C9.32203 15.0264 9.1 14.395 9.1 13.5H7.9C7.9 14.605 8.17797 15.4736 8.62577 16.1453C9.07106 16.8133 9.66049 17.2511 10.2317 17.5367C10.8005 17.8211 11.3621 17.9603 11.7764 18.0293C11.9849 18.0641 12.1601 18.0817 12.2854 18.0907C12.3481 18.0951 12.3987 18.0975 12.4351 18.0987C12.4533 18.0993 12.468 18.0996 12.4788 18.0998C12.4843 18.0999 12.4888 18.0999 12.4923 18.1C12.4941 18.1 12.4956 18.1 12.4969 18.1C12.4975 18.1 12.4981 18.1 12.4986 18.1C12.4989 18.1 12.4992 18.1 12.4994 18.1C12.4997 18.1 12.5 18.1 12.5 17.5ZM9.1 13.5V9.5H7.9V13.5H9.1ZM9.5 9.5C10.1 9.5 10.1 9.50028 10.1 9.50055C10.1 9.50063 10.1 9.50089 10.1 9.50104C10.1 9.50134 10.1 9.5016 10.1 9.50182C10.1 9.50225 10.1 9.5025 10.1 9.50259C10.1 9.50276 10.1 9.50224 10.1 9.50107C10.1001 9.49872 10.1002 9.49374 10.1004 9.4863C10.1009 9.4714 10.102 9.44678 10.1043 9.41384C10.1091 9.34776 10.1188 9.24944 10.1387 9.12989C10.179 8.88793 10.2586 8.5745 10.4117 8.26833C10.5636 7.96451 10.782 7.67894 11.0984 7.46798C11.4111 7.25953 11.855 7.1 12.5 7.1V5.9C11.645 5.9 10.9639 6.11547 10.4328 6.46952C9.90549 6.82106 9.56143 7.28549 9.33834 7.73167C9.11643 8.1755 9.00846 8.61207 8.95504 8.93261C8.92809 9.09431 8.91438 9.23036 8.90738 9.32835C8.90388 9.37744 8.90203 9.41727 8.90107 9.44632C8.90058 9.46085 8.90031 9.47272 8.90017 9.48172C8.9001 9.48622 8.90005 9.49001 8.90003 9.49306C8.90002 9.49459 8.90001 9.49593 8.90001 9.49709C8.9 9.49767 8.9 9.4982 8.9 9.49869C8.9 9.49893 8.9 9.49926 8.9 9.49938C8.9 9.4997 8.9 9.5 9.5 9.5ZM12.5 7.1C13.145 7.1 13.5889 7.25953 13.9016 7.46798C14.218 7.67894 14.4364 7.96451 14.5883 8.26833C14.7414 8.5745 14.821 8.88793 14.8613 9.12989C14.8812 9.24944 14.8909 9.34776 14.8957 9.41384C14.898 9.44678 14.8991 9.4714 14.8996 9.4863C14.8998 9.49374 14.8999 9.49872 14.9 9.50107C14.9 9.50224 14.9 9.50276 14.9 9.50259C14.9 9.5025 14.9 9.50225 14.9 9.50182C14.9 9.5016 14.9 9.50134 14.9 9.50104C14.9 9.50089 14.9 9.50063 14.9 9.50055C14.9 9.50028 14.9 9.5 15.5 9.5C16.1 9.5 16.1 9.4997 16.1 9.49938C16.1 9.49926 16.1 9.49893 16.1 9.49869C16.1 9.4982 16.1 9.49767 16.1 9.49709C16.1 9.49593 16.1 9.49459 16.1 9.49306C16.0999 9.49001 16.0999 9.48622 16.0998 9.48172C16.0997 9.47272 16.0994 9.46085 16.0989 9.44632C16.098 9.41727 16.0961 9.37744 16.0926 9.32835C16.0856 9.23036 16.0719 9.09431 16.045 8.93261C15.9915 8.61207 15.8836 8.1755 15.6617 7.73167C15.4386 7.28549 15.0945 6.82106 14.5672 6.46952C14.0361 6.11547 13.355 5.9 12.5 5.9V7.1ZM11.9 9.5V17.5H13.1V9.5H11.9ZM8.5 9.9C7.71525 9.9 7.10887 9.51034 6.67426 9.07574C6.45859 8.86006 6.29547 8.64279 6.18673 8.47968C6.1327 8.39863 6.09302 8.33235 6.06782 8.28825C6.05524 8.26624 6.04634 8.24988 6.04113 8.24011C6.03853 8.23523 6.03685 8.232 6.0361 8.23055C6.03573 8.22983 6.03559 8.22955 6.03568 8.22973C6.03573 8.22982 6.03583 8.23003 6.03599 8.23035C6.03607 8.23051 6.03617 8.2307 6.03628 8.23092C6.03634 8.23103 6.03643 8.23122 6.03646 8.23127C6.03656 8.23147 6.03666 8.23167 5.5 8.5C4.96334 8.76833 4.96345 8.76855 4.96357 8.76877C4.96361 8.76886 4.96372 8.76909 4.96381 8.76926C4.96398 8.7696 4.96417 8.76997 4.96437 8.77038C4.96478 8.77119 4.96525 8.77212 4.96579 8.77317C4.96685 8.77527 4.96818 8.77786 4.96976 8.78092C4.97292 8.78704 4.9771 8.79505 4.98231 8.80481C4.99272 8.82434 5.00726 8.85094 5.02593 8.88362C5.06323 8.9489 5.1173 9.03887 5.18827 9.14532C5.32953 9.35721 5.54141 9.63994 5.82574 9.92426C6.39113 10.4897 7.28475 11.1 8.5 11.1V9.9ZM16.5 11.1C17.7153 11.1 18.6089 10.4897 19.1743 9.92426C19.4586 9.63994 19.6705 9.35721 19.8117 9.14532C19.8827 9.03887 19.9368 8.9489 19.9741 8.88362C19.9927 8.85094 20.0073 8.82434 20.0177 8.80481C20.0229 8.79505 20.0271 8.78704 20.0302 8.78092C20.0318 8.77786 20.0331 8.77527 20.0342 8.77317C20.0347 8.77212 20.0352 8.77119 20.0356 8.77038C20.0358 8.76997 20.036 8.7696 20.0362 8.76926C20.0363 8.76909 20.0364 8.76886 20.0364 8.76877C20.0365 8.76855 20.0367 8.76833 19.5 8.5C18.9633 8.23167 18.9634 8.23147 18.9635 8.23127C18.9636 8.23122 18.9637 8.23103 18.9637 8.23092C18.9638 8.2307 18.9639 8.23051 18.964 8.23035C18.9642 8.23003 18.9643 8.22982 18.9643 8.22973C18.9644 8.22955 18.9643 8.22983 18.9639 8.23055C18.9632 8.232 18.9615 8.23523 18.9589 8.24011C18.9537 8.24988 18.9448 8.26624 18.9322 8.28825C18.907 8.33235 18.8673 8.39863 18.8133 8.47968C18.7045 8.64279 18.5414 8.86006 18.3257 9.07574C17.8911 9.51034 17.2847 9.9 16.5 9.9V11.1ZM16.5 13.1H20V11.9H16.5V13.1ZM16.5 15.1C17.2847 15.1 17.8911 15.4897 18.3257 15.9243C18.5414 16.1399 18.7045 16.3572 18.8133 16.5203C18.8673 16.6014 18.907 16.6676 18.9322 16.7117C18.9448 16.7338 18.9537 16.7501 18.9589 16.7599C18.9615 16.7648 18.9632 16.768 18.9639 16.7694C18.9643 16.7702 18.9644 16.7705 18.9643 16.7703C18.9643 16.7702 18.9642 16.77 18.964 16.7697C18.9639 16.7695 18.9638 16.7693 18.9637 16.7691C18.9637 16.769 18.9636 16.7688 18.9635 16.7687C18.9634 16.7685 18.9633 16.7683 19.5 16.5C20.0367 16.2317 20.0365 16.2315 20.0364 16.2312C20.0364 16.2311 20.0363 16.2309 20.0362 16.2307C20.036 16.2304 20.0358 16.23 20.0356 16.2296C20.0352 16.2288 20.0347 16.2279 20.0342 16.2268C20.0331 16.2247 20.0318 16.2221 20.0302 16.2191C20.0271 16.213 20.0229 16.205 20.0177 16.1952C20.0073 16.1757 19.9927 16.1491 19.9741 16.1164C19.9368 16.0511 19.8827 15.9611 19.8117 15.8547C19.6705 15.6428 19.4586 15.3601 19.1743 15.0757C18.6089 14.5103 17.7153 13.9 16.5 13.9V15.1ZM8.5 13.9C7.28475 13.9 6.39113 14.5103 5.82574 15.0757C5.54141 15.3601 5.32953 15.6428 5.18827 15.8547C5.1173 15.9611 5.06323 16.0511 5.02593 16.1164C5.00726 16.1491 4.99272 16.1757 4.98231 16.1952C4.9771 16.205 4.97292 16.213 4.96976 16.2191C4.96818 16.2221 4.96685 16.2247 4.96579 16.2268C4.96525 16.2279 4.96478 16.2288 4.96437 16.2296C4.96417 16.23 4.96398 16.2304 4.96381 16.2307C4.96372 16.2309 4.96361 16.2311 4.96357 16.2312C4.96345 16.2315 4.96334 16.2317 5.5 16.5C6.03666 16.7683 6.03656 16.7685 6.03646 16.7687C6.03643 16.7688 6.03634 16.769 6.03628 16.7691C6.03617 16.7693 6.03607 16.7695 6.03599 16.7697C6.03583 16.77 6.03573 16.7702 6.03568 16.7703C6.03559 16.7705 6.03573 16.7702 6.0361 16.7694C6.03685 16.768 6.03853 16.7648 6.04113 16.7599C6.04634 16.7501 6.05524 16.7338 6.06782 16.7117C6.09302 16.6676 6.1327 16.6014 6.18673 16.5203C6.29547 16.3572 6.45859 16.1399 6.67426 15.9243C7.10887 15.4897 7.71525 15.1 8.5 15.1V13.9ZM8.5 11.9H5V13.1H8.5V11.9Z" fill="currentColor" />
  </svg>
)
/** Sanity's CommentIcon. */
export const CommentIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M7.5 16.5H9.5V20.5L13.5 16.5H17.5C18.6046 16.5 19.5 15.6046 19.5 14.5V8.5C19.5 7.39543 18.6046 6.5 17.5 6.5H7.5C6.39543 6.5 5.5 7.39543 5.5 8.5V14.5C5.5 15.6046 6.39543 16.5 7.5 16.5Z" />
  </svg>
)
/** Sanity's AddCommentIcon: a speech bubble with a plus. */
/** Sanity's AddCommentIcon. */
export const AddComment = () => (
  <svg {...solid}>
    <path d="M13 6.5H7.5C6.39543 6.5 5.5 7.39543 5.5 8.5V14.5C5.5 15.6046 6.39543 16.5 7.5 16.5H9.5V20.5L13.5 16.5H16.5C17.6046 16.5 18.5 15.6046 18.5 14.5V12M15 6.5H22M18.5 10V3" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
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
  <svg {...solid}>
    <path d="M10.5 16V9L16 12.5L10.5 16Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
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
  <svg {...solid}>
    <path d="M8 5.5H6.5V19.5H18.5V5.5H17M12.5 3C11.5 3 11.5 4.5 11 4.5C10 4.5 9.5 5 9.5 6.5H15.6C15.6 5 15 4.5 14 4.5C13.5 4.5 13.5 3 12.5 3Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's CheckmarkCircleIcon (the validation button when only infos are left). */
export const CheckmarkCircle = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M9.5 12.1316L11.7414 14.5L16 10M20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C8.08172 20.5 4.5 16.9183 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5Z" />
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
  <svg {...solid}>
    <path d="M4.99997 5.50006H20M12.5 9.00005V20" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M7.5 14L12.5 9.00006L17.5 14" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's EditIcon (a history entry's "Edited" badge). */
export const EditIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M15 7L18 10M6 19L7 15L17 5L20 8L10 18L6 19Z" />
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
  <svg {...solid}>
    <path d="M13.5 4.5H12.5C8.08172 4.5 4.5 8.08172 4.5 12.5C4.5 15.6631 6.33576 18.3975 9 19.6958M11.5 20.5H12.5C16.9183 20.5 20.5 16.9183 20.5 12.5C20.5 9.33688 18.6642 6.60253 16 5.30423" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M14 17.5619L11.5 20.5L14.5 23.0619M11 7.43811L13.5 4.50001L10.5 1.93811" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const EarthGlobe = () => (
  <svg {...solid}>
    <path d="M20.5 12.5C20.5 16.9183 16.9183 20.5 12.5 20.5C8.08172 20.5 4.5 16.9183 4.5 12.5C4.5 8.08172 8.08172 4.5 12.5 4.5C16.9183 4.5 20.5 8.08172 20.5 12.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M20.5 12.5H4.5M12.5 20.5C12.5 20.5 9.5 17.5 9.5 12.5C9.5 7.5 12.5 4.5 12.5 4.5C12.5 4.5 15.5 7.5 15.5 12.5C15.5 17.5 12.5 20.5 12.5 20.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const Mobile = () => (
  <svg {...s}>
    <rect x="8.5" y="5.5" width="8" height="14" rx="1" />
    <path d="M11.5 17.5h2" />
  </svg>
)
/** Sanity's InsertAboveIcon and InsertBelowIcon: an array item's Add item before / after. */
export const InsertAbove = () => (
  <svg {...s} strokeLinecap="square" strokeLinejoin="round">
    <path d="M14.5 10.5556L10.5 10.5556M12.5 12.5L12.5 8.5M18.5 5.5L6.5 5.5M18.5 19.5L6.5 19.5L6.5 15.5L18.5 15.5L18.5 19.5Z" />
  </svg>
)
export const InsertBelow = () => (
  <svg {...s}>
    <path d="M10.5 14.5H14.5M12.5 12.5V16.5M6.5 19.5H18.5M6.5 5.5H18.5V9.5H6.5V5.5Z" />
  </svg>
)
/** Sanity's AddDocumentIcon: an array item's Duplicate. */
export const AddDocument = () => (
  <svg {...s}>
    <path d="M11.5 4.5V9.5H6.5" />
    <path d="M11.5 4.5H18.5V12M11.5 4.5L6.5 9.5M11.5 4.5V9.5H6.5M6.5 9.5V19.5H11M20 17.5H16.5M16.5 17.5H13M16.5 17.5V14M16.5 17.5V21" />
  </svg>
)
/** Sanity's LaunchIcon. */
export const LaunchIcon = () => (
  <svg {...s}>
    <path d="M12 7.5H6.5V18.5H17.5V13M19.5 5.5L10.5 14.5" />
    <path d="M14 5.5H19.5V11" />
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
/** Sanity's InlineElementIcon: an inline object in the text (a chip). */
export const InlineIcon = () => (
  <svg {...solid}>
    <path d="M12.5 6.5H19.5V18.5H12.5M12.5 6.5H5.5V18.5H12.5M12.5 6.5V18.5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** A link to a document (Sanity's internal link annotation): a page with a link. */
export const DocLinkIcon = () => (
  <svg {...s}>
    <path d="M10 5.5H6.5V19.5H18.5V14M13.5 5.5H18.5V10.5M18.5 5.5L11.5 12.5" />
  </svg>
)
/** Sanity's BlockElementIcon: an inserted block object (a callout). */
export const BlockIcon = () => (
  <svg {...s}>
    <path d="M5 19.5H20M5 5.5H20M6.5 8.5H18.5V16.5H6.5V8.5Z" />
  </svg>
)
// Sanity's Play and Stop (Vision's Fetch and Listen), filled.
/** Sanity's PlayIcon: filled and stroked, round corners. */
export const PlayIcon = () => (
  <svg {...solid}>
    <path d="M7.5 18.5V6.5L17.5 12.5L7.5 18.5Z" fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
export const StopIcon = () => (
  <svg {...solid}>
    <rect x={7.5} y={7.5} width={10} height={10} fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's UserIcon (a task's Assign to). */
export const UserIcon = () => (
  <svg {...s} strokeLinejoin="round">
    <path d="M8 14.5C7 15 5.5 16 5.5 19.5H19.5C19.5 16 18.3416 15.1708 17 14.5C16 14 14 14 14 12.5C14 11 15 10.25 15 8.25C15 6.25 14 5.25 12.5 5.25C11 5.25 10 6.25 10 8.25C10 10.25 11 11 11 12.5C11 14 9 14 8 14.5Z" />
  </svg>
)
/** Sanity's TaskIcon (Create new task). */
export const TaskIcon = () => (
  <svg {...solid}>
    <path d="M20.5 10.75V19.75H4.5V10.75M20.5 10.75V5.75H17.5M20.5 10.75H4.5M4.5 10.75V5.75H7.5M7.5 5.75H17.5M7.5 5.75V8.25M7.5 5.75V3.25M17.5 5.75V8.25M17.5 5.75V3.25M9.7002 14.7358L11.7002 16.7358L15.3002 13.1758" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's RestoreIcon (History). */
export const RestoreIcon = () => (
  <svg {...solid}>
    <path d="M5.88468 17C7.32466 19.1128 9.75033 20.5 12.5 20.5C16.9183 20.5 20.5 16.9183 20.5 12.5C20.5 8.08172 16.9183 4.5 12.5 4.5C8.08172 4.5 4.5 8.08172 4.5 12.5V13.5M12.5 8V12.5L15.5 15.5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M7 11L4.5 13.5L2 11" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's JsonIcon (Inspect). */
export const JsonIcon = () => (
  <svg {...solid}>
    <path d="M11 5.5H9.5C8.39543 5.5 7.5 6.39543 7.5 7.5V12.5M7.5 12.5H4M7.5 12.5V17.5C7.5 18.6046 8.39543 19.5 9.5 19.5H11M14 5.5H15.5C16.6046 5.5 17.5 6.39543 17.5 7.5V12.5M17.5 12.5H21M17.5 12.5V17.5C17.5 18.6046 16.6046 19.5 15.5 19.5H14" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's EarthAmericasIcon (Open preview). */
export const EarthAmericas = () => (
  <svg {...solid}>
    <path d="M7 13L5.5 9L10 5H15V10L14 9H11L9.5 11L10.5 12H12V13L13 14.5H15.5L18.5 17L15.5 19.5L10.5 20V17L12.5 15L9 13L7 10.5V13Z" fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <circle cx={12.5} cy={12.5} r={8} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
/** Sanity's FeedbackIcon (Help, Send feedback). */
export const FeedbackIcon = () => (
  <svg {...solid}>
    <path d="M10 11.5V12H9.5L9.5 11.5H10Z" fill="currentColor" />
    <path d="M13 11.5V12H12.5V11.5H13Z" fill="currentColor" />
    <path d="M16 11.5V12H15.5V11.5H16Z" fill="currentColor" />
    <path d="M10 11.5V12H9.5L9.5 11.5H10Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M13 11.5V12H12.5V11.5H13Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M16 11.5V12H15.5V11.5H16Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    <path d="M7.5 16.5H9.5V20.5L13.5 16.5H17.5C18.6046 16.5 19.5 15.6046 19.5 14.5V8.5C19.5 7.39543 18.6046 6.5 17.5 6.5H7.5C6.39543 6.5 5.5 7.39543 5.5 8.5V14.5C5.5 15.6046 6.39543 16.5 7.5 16.5Z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)
