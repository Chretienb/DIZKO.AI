import React from 'react'

export const UserContext = React.createContext(null)

export function useUser() {
  return React.useContext(UserContext)
}
