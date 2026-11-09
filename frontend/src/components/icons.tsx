// Inline stroke icons from the Vaktaplan design.
const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...base} stroke="#37083e" strokeWidth={2.2}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4M8 14h3" />
  </svg>
)

export const SparkleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
)

export const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth={2.4}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

export const CloseIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const AlertIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} strokeWidth={2.2} style={{ flex: 'none', marginTop: 1 }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </svg>
)

export const ArrowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...base} stroke="#9d9898" strokeWidth={2.2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const RibbonMark = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="2" y="3" width="16" height="4" rx="2" fill="#f6e6a6" />
    <rect x="2" y="8" width="16" height="4" rx="2" fill="#f2c9c2" />
    <rect x="2" y="13" width="16" height="4" rx="2" fill="#8fb3e0" />
  </svg>
)

export const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...base} stroke="#8fa39d" strokeWidth={2}>
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
  </svg>
)

export const UndoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 010 10h-3" />
  </svg>
)

export const RefreshIcon = ({ spinning = false }: { spinning?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth={2.2} className={spinning ? 'spin' : undefined}>
    <path d="M21 12a9 9 0 11-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
)

export const ErrorDot = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#b42318" />
    <path d="M12 7v6M12 16.5v.5" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" />
  </svg>
)

export const WarnDot = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l10.5 19h-21z" fill="#a35c00" />
    <path d="M12 9v5M12 17.5v.5" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" />
  </svg>
)

export const LockIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="10" width="16" height="12" rx="3" fill="#1f2528" stroke="#ffffff" strokeWidth={2} />
    <path d="M8 10V7a4 4 0 018 0v3" fill="none" stroke="#1f2528" strokeWidth={3} />
  </svg>
)

export const DotsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
)

export const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...base} strokeWidth={2.2}>
    <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
  </svg>
)

export const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} strokeWidth={2}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
)
