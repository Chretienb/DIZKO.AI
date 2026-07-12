import React from 'react'
import { motion } from 'motion/react'
import { Play, Heart } from 'lucide-react'
import Cover from './Cover.jsx'
import { timeAgo } from '../lib/utils.js'

// ── Premium project card ──────────────────────────────────────────────────────
// The one shared card for project grids (Dashboard now; Projects/Library/
// ProjectView adopt it in later rebrand milestones). Square artwork, quiet
// metadata, hover lift with a play affordance.
export default function ProjectCard({ project, active = false, fav = false, onToggleFav, onOpen, onSelect }) {
  const p = project
  return (
    <motion.div
      role="button" tabIndex={0}
      aria-label={`${p.title} — ${p.status || 'Draft'}`}
      onClick={() => onSelect?.(p)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p) } }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.28, ease: [0.25, 0.6, 0.3, 1] }}
      className="pcard"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: 10, cursor: 'pointer',
        background: 'var(--surface)', borderRadius: 'var(--r-2)',
        border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
        boxShadow: 'var(--shadow-1)', outline: 'none' }}>

      {/* Artwork */}
      <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 'calc(var(--r-2) - 4px)', overflow: 'hidden' }}>
        <div className="pcard-art" style={{ position: 'absolute', inset: 0, transition: 'transform .35s var(--ease)' }}>
          <Cover seed={p.id} size="full" radius={0} coverUrl={p.cover_url}/>
        </div>
        {/* Play / open affordance — appears on hover, opens the project */}
        <button
          className="pcard-play"
          aria-label={`Open ${p.title}`}
          onClick={e => { e.stopPropagation(); onOpen?.(p) }}
          style={{ position: 'absolute', right: 10, bottom: 10, width: 40, height: 40, borderRadius: '50%',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--brand-strong)', color: '#fff', boxShadow: 'var(--shadow-2)',
            opacity: 0, transform: 'translateY(6px)', transition: 'opacity .2s var(--ease), transform .2s var(--ease)' }}>
          <Play size={15} fill="#fff" strokeWidth={0} style={{ marginLeft: 2 }}/>
        </button>
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '0 2px 2px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-.2px', color: 'var(--t1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>{p.type || 'Single'}</span>
            {(p.updated_at || p.created_at) && (
              <>
                <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--t4)' }}/>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--t4)' }}>{timeAgo(p.updated_at || p.created_at)}</span>
              </>
            )}
          </div>
        </div>
        <button
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav}
          onClick={e => { e.stopPropagation(); onToggleFav?.(p.id) }}
          className={`pcard-heart ${fav ? 'on' : ''}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', flexShrink: 0,
            color: fav ? 'var(--brand)' : 'var(--t4)' }}>
          <Heart size={14} fill={fav ? 'currentColor' : 'none'}/>
        </button>
      </div>

      <style>{`
        .pcard:hover { box-shadow: var(--shadow-2); border-color: var(--line-4); }
        .pcard:hover .pcard-art { transform: scale(1.04); }
        .pcard:hover .pcard-play { opacity: 1; transform: translateY(0); }
        .pcard:focus-visible .pcard-play { opacity: 1; transform: translateY(0); }
        .pcard .pcard-heart { opacity: 0; transition: opacity .15s; }
        .pcard:hover .pcard-heart, .pcard .pcard-heart.on { opacity: 1; }
      `}</style>
    </motion.div>
  )
}
