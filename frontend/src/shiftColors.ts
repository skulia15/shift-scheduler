/** Shift colours by shift-type position: lime, pink, plum, then extras for added shift types. */
const PALETTE = [
  { bg: '#e9f4b3', fg: '#2f3513' },
  { bg: '#fae0fe', fg: '#4e0e58' },
  { bg: '#37083e', fg: '#fdf0ff' },
  { bg: '#dbe7f6', fg: '#16325c' },
  { bg: '#fde2c8', fg: '#6b3205' },
  { bg: '#d9efe6', fg: '#14453a' },
]

export function shiftColor(index: number) {
  return PALETTE[index % PALETTE.length]
}
