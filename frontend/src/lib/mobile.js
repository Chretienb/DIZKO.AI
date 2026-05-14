import React from 'react'

export const MobileCtx = React.createContext(false)

export function useIsMobile() {
  const [w, setW] = React.useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  )
  React.useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return w < 768
}
