import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { showcaseApi } from '../lib/api.js'
import { C } from './ui/index.jsx'

// Compact dashboard switch: flip it to OPEN your public producer page (and go
// live). It rests OFF while you're in the app — coming back from your public
// page leaves it left. Persistent public/private is managed in the editor.
export default function PublicProfileToggle() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [handle, setHandle]   = useState(null)
  const [on, setOn]           = useState(false)   // visual only — always rests off on the dashboard
  const [busy, setBusy]       = useState(false)

  useEffect(() => {
    showcaseApi.me()
      .then(r => setHandle(r?.data?.profile?.handle || null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const open = async () => {
    if (busy) return
    if (!handle) { navigate('/profile/edit'); return }   // claim a handle first
    setOn(true); setBusy(true)
    try { await showcaseApi.updateProfile({ profile_public: true }) } catch {}
    navigate(`/u/${handle}`)
  }

  if (loading) return null

  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:10 }}>
      <span onClick={open} style={{ fontSize:12.5, fontWeight:600, color: handle ? C.t1 : C.t3, whiteSpace:'nowrap', cursor:'pointer' }}>
        {handle ? `@${handle}` : 'Public profile'}
      </span>
      <button onClick={open} aria-label="Open public profile" disabled={busy}
        style={{ width:42, height:24, borderRadius:12, border:'none', cursor:busy?'default':'pointer', position:'relative', flexShrink:0,
          background: on ? C.coral : 'rgba(var(--fg),.18)', transition:'background .2s', opacity:busy?.7:1 }}>
        <span style={{ position:'absolute', top:3, left: on?21:3, width:18, height:18, borderRadius:'50%', background:'#fff',
          boxShadow:'0 1px 2px rgba(0,0,0,.3)', transition:'left .2s cubic-bezier(.4,0,.2,1)' }} />
      </button>
    </div>
  )
}
