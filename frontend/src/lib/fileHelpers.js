// Shared helpers for rendering files/stems and status pills.
// Used by App.jsx and components/modals.jsx.

export function fileLabel(f) {
  return f?.suggested_name || f?.original_name || 'Untitled'
}

export function fileMeta(f) {
  const parts = [f?.instrument, f?.mime_type?.split('/')?.[1]?.toUpperCase()].filter(Boolean)
  return parts.join(' · ') || 'audio'
}

export const typeColor = t =>
  ({ WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }[t] || '#aaa')

const ROSE = '#E8709A'
export const statusStyle = s => ({
  done:         { bg:'rgba(34,197,94,.1)',    color:'#16a34a', border:'rgba(34,197,94,.2)'   },
  review:       { bg:'rgba(245,201,122,.15)', color:'#b45309', border:'rgba(245,201,122,.4)' },
  'new takes':  { bg:'rgba(232,112,154,.12)', color:ROSE,      border:'rgba(232,112,154,.3)'  },
  'In Progress':{ bg:'rgba(59,130,246,.1)',   color:'#2563eb', border:'rgba(59,130,246,.2)'  },
  'Review':     { bg:'rgba(245,201,122,.15)', color:'#b45309', border:'rgba(245,201,122,.4)' },
  'New Takes':  { bg:'rgba(232,112,154,.12)', color:ROSE,      border:'rgba(232,112,154,.3)'  },
  'Draft':      { bg:'rgba(var(--fg),.06)',   color:'rgba(var(--fg),.5)', border:'rgba(var(--fg),.12)' },
}[s] || { bg:'rgba(var(--fg),.06)', color:'rgba(var(--fg),.5)', border:'rgba(var(--fg),.12)' })
