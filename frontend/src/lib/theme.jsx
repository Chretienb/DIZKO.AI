import React, { createContext, useContext, useState, useCallback } from 'react'

// Theme system — light / dark. Default is always dark for anyone without an
// explicit choice saved yet — we don't follow the OS preference.
// Persists the user's explicit choice to localStorage.
// The actual `data-theme` attribute is set BEFORE React mounts by the inline
// bootstrap script in index.html (see applyTheme below for the matching logic),
// so this provider only needs to keep state in sync and react to changes.

const STORAGE_KEY = 'dizko_theme'   // 'light' | 'dark' | 'system' ('system' = no explicit choice yet, resolves to dark)

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch { return 'system' }
}

export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme
  return 'dark'
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

  return (
    <ThemeCtx.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeCtx)
}
