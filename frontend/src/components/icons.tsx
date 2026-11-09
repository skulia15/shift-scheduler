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
