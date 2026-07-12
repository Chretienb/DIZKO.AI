// Shared helpers for rendering a collaborator (name / email / color / initials).
// Used by App.jsx and components/modals.jsx.
import { initials } from './utils.js'

const COLLAB_COLORS = ['#7C6CF0', '#22c55e', '#F5C97A', '#8b5cf6', '#3b82f6', '#A78BFA']

export function collabName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) {
    // Title-case names stored in all-lowercase
    return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  }
  // Fall back to the part before @ in email, title-cased
  const email = c?.user?.email || c?.email || ''
  if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  return 'Collaborator'
}

export function collabInitials(c) {
  return initials(collabName(c)) || '?'
}

export function collabEmail(c) {
  return c?.user?.email || c?.email || ''
}

export function collabColor(i) {
  return COLLAB_COLORS[i % COLLAB_COLORS.length]
}
