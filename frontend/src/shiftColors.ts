/** Shift colours by shift-type position: morning, evening, night, then extras for added shift types. */
const PALETTE = [
  { bg: '#f6e6a6', fg: '#4a3b00' },
  { bg: '#f2c9c2', fg: '#5c1f17' },
  { bg: '#1f3a5f', fg: '#e8f0fa' },
  { bg: '#cfe7e4', fg: '#084f4b' },
  { bg: '#e2d7f0', fg: '#3b2560' },
  { bg: '#d9e6c8', fg: '#2c4214' },
]

export function shiftColor(index: number) {
  return PALETTE[index % PALETTE.length]
}
