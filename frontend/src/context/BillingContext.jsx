import React from 'react'
import { billingApi } from '../lib/api.js'

export const BillingContext = React.createContext(null)

export function useBilling() {
  return React.useContext(BillingContext)
}

export function BillingProvider({ userId, children }) {
  const [billingStatus, setBillingStatus] = React.useState(null)
  const [billingLoaded, setBillingLoaded] = React.useState(false)

  React.useEffect(() => {
    if (!userId) return
    billingApi.status()
      .then(r => { setBillingStatus(r?.data); setBillingLoaded(true) })
      .catch(() => setBillingLoaded(true))
  }, [userId])

  const hasAccess = billingLoaded
    ? (!!billingStatus?.has_payment_method && billingStatus?.subscription_status !== 'canceled')
    : false

  return (
    <BillingContext.Provider value={{ billingStatus, billingLoaded, hasAccess }}>
      {children}
    </BillingContext.Provider>
  )
}
