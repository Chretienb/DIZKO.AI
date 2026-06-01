import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

// Theme system — light / dark with system-preference following.
// Persists the user's explicit choice to localStorage; otherwise follows the OS.
// The actual `data-theme` attribute is set BEFORE React mounts by the inline
// bootstrap script in index.html (see applyTheme below for the matching logic),
// so this provider only needs to keep state in sync and react to changes.

const STORAGE_KEY = 'dizko_theme'   // 'light' | 'dark' | 'system'

const mql = () => window.matchMedia('(prefers-color-scheme: dark)')

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch { return 'system' }
}

export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme
  return mql().matches ? 'dark' : 'light'
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme)
}

const ThemeCtx = createContext({
  theme: 'system', resolvedTheme: 'dark', setTheme: () => {}, toggle: () => {},
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(getStoredTheme()))

  const setTheme = useCallback((next) => {
    setThemeState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    applyTheme(next)
    setResolvedTheme(resolveTheme(next))
  }, [])

  // Toggle flips the *resolved* appearance and stores it as an explicit choice.
  const toggle = useCallback(() => {
    setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  // While following the system, react to OS appearance changes live.
  useEffect(() => {
    if (theme !== 'system') return
    const m = mql()
    const onChange = () => { applyTheme('system'); setResolvedTheme(resolveTheme('system')) }
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [theme])

  return (
    <ThemeCtx.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeCtx)
}
