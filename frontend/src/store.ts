import { useEffect, useState } from 'react'

/** useState persisted to localStorage (per-browser save of the planner's work). */
export function usePersisted<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage full or blocked: the session still works, it just isn't saved.
    }
  }, [key, value])
  return [value, setValue]
}

export function download(filename: string, content: string | Blob, type: string) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function newId(prefix: string, existing: { id: string }[]): string {
  let i = existing.length + 1
  while (existing.some((e) => e.id === `${prefix}${i}`)) i++
  return `${prefix}${i}`
}
