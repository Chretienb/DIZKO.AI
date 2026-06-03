import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { Avatar } from '../components/ui/index.jsx'
import { peersFromState, colorFor } from './presence.js'

/**
 * Subscribe to a per-project presence channel and return the live peer list.
 * Mirrors the global presence channel in App.jsx, scoped to one project's
 * Studio so collaborators can see who else is working on it right now.
 */
export function useStudioPresence(projectId, user) {
  const [peers, setPeers] = useState([])
  useEffect(() => {
    if (!projectId || !user?.id) { setPeers([]); return }
    const meta = {
      user_id: user.id,
      name:    user.full_name || user.email || 'You',
      avatar:  user.avatar_url || '',
      color:   colorFor(user.id),
    }
    const channel = supabase.channel(`studio-presence:${projectId}`, {
      config: { presence: { key: user.id } },
    })
    const sync = () => setPeers(peersFromState(channel.presenceState(), user.id))
    channel
      .on('presence', { event: 'sync' },  sync)
      .on('presence', { event: 'join' },  sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') { await channel.track(meta); sync() }
      })
    return () => { supabase.removeChannel(channel) }
  }, [projectId, user?.id])
  return peers
}

/** Overlapping avatar stack of the *other* people live in this project. */
export function PresenceBar({ peers }) {
  const others = peers.filter(p => !p.isSelf)
  if (others.length === 0) return null

  const shown = others.slice(0, 4)
  const extra = others.length - shown.length
  const label = `${others.length} collaborator${others.length > 1 ? 's' : ''} live`

  return (
    <div role="status" aria-label={label} title={label}
      style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
      <span aria-hidden="true" style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e',
        boxShadow:'0 0 0 3px rgba(34,197,94,.22)' }} />
      <div style={{ display:'flex' }}>
        {shown.map((p, i) => (
          <Avatar key={p.user_id} name={p.name} url={p.avatar || undefined} color={p.color} size={24}
            border="2px solid var(--surface-2)"
            style={{ marginLeft: i ? -8 : 0, position:'relative', zIndex: shown.length - i }} />
        ))}
        {extra > 0 && (
          <div aria-hidden="true" style={{ marginLeft:-8, width:24, height:24, borderRadius:'50%',
            background:'var(--surface)', border:'2px solid var(--surface-2)', display:'flex',
            alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'var(--t2)' }}>
            +{extra}
          </div>
        )}
      </div>
    </div>
  )
}
