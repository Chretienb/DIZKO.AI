import { useState, useRef } from 'react'

// Two-click confirm: first arm(id) returns false + arms; second arm(id) within
// 4s returns true (confirmed). Resets automatically.
export function useConfirm() {
  const [pending, setPending] = useState(null)
  const timer = useRef(null)
  const arm = (id) => {
    if (pending === id) return true
    clearTimeout(timer.current)
    setPending(id)
    timer.current = setTimeout(() => setPending(null), 4000)
    return false
  }
  const cancel = () => { clearTimeout(timer.current); setPending(null) }
  return { pending, arm, cancel }
}
