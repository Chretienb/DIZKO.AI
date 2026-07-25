import React from 'react'
import { Capacitor } from '@capacitor/core'

export const MobileCtx = React.createContext(false)

// True only inside the native iOS/Android shell — false on web, including
// mobile-width web (isMobile/useIsMobile is about viewport size, this is
// about which App Store rules apply). Apple rejects apps that sell/upsell
// subscriptions in-app outside StoreKit (Guideline 3.1.1); gates the billing
// UI in modals.jsx so the native build points out to Safari for checkout
// instead, while the web app keeps its normal in-app Stripe flow untouched.
export const IS_NATIVE = Capacitor.isNativePlatform()

// Content height of the mobile bottom tab bar (excludes the safe-area inset,
// which callers add on top via env(safe-area-inset-bottom)). Shared by
// App.jsx (renders the bar + reserves main's padding), MiniPlayer.jsx (sits
// above it instead of at the true screen bottom), and CookieConsent.jsx
// (same) — one number so the three can't drift out of sync.
export const MOBILE_TAB_BAR_HEIGHT = 58

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
