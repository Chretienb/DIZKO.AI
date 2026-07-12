import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn's class combiner — lives here (not lib/utils.js) because utils.js
// predates shadcn and exports app helpers; components.json aliases point at
// this module.
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
