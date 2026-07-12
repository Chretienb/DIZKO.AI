import React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Mic2, Users, AudioLines } from 'lucide-react'
import { Button } from '../ui/button.jsx'
import Cover from '../Cover.jsx'
import { timeAgo } from '../../lib/utils.js'

function Stat({ icon: Icon, value, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 13px',
      borderRadius: 'var(--r-pill)', background: 'var(--brand-tint)' }}>
      <Icon size={13} style={{ color: 'var(--brand)' }}/>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--t1)' }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--t3)' }}>{label}</span>
    </div>
  )
}

// ── "Continue Creating" hero ──────────────────────────────────────────────────
// The Dashboard's editorial lead: the selected (default: most recent) project
// as a big crossfading cover with resume CTAs — not another list row.
export default function Hero({ project, stemCount = 0, contributorCount = 0, onResume, onOpenStudio, isMobile }) {
  if (!project) return null
  return (
    <section aria-label="Continue creating" style={{
      display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '340px 1fr', gap: isMobile ? 16 : 32,
      padding: isMobile ? 16 : 28, background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 'var(--r-3)', boxShadow: 'var(--shadow-1)',
      overflow: 'hidden', position: 'relative' }}>

      {/* Ambient brand wash behind the content — subtle, not a gradient poster */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(60% 90% at 0% 0%, var(--brand-tint) 0%, transparent 55%)' }}/>

      {/* Cover — crossfades when the selected project changes */}
      <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 'var(--r-2)', overflow: 'hidden',
        boxShadow: 'var(--shadow-2)' }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={project.id} style={{ position: 'absolute', inset: 0 }}
            initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 0.6, 0.3, 1] }}>
            <Cover seed={project.id} size="full" radius={0} coverUrl={project.cover_url}/>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Copy + CTAs */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, position: 'relative' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '.16em',
          textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 12 }}>
          Continue creating
        </div>
        <h2 style={{ margin: 0, fontSize: isMobile ? 26 : 34, fontWeight: 650, letterSpacing: '-1px',
          lineHeight: 1.08, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {project.title}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--t3)' }}>{project.type || 'Project'}</span>
          {(project.updated_at || project.created_at) && (
            <>
              <span aria-hidden="true" style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--t4)' }}/>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t3)' }}>
                updated {timeAgo(project.updated_at || project.created_at)}
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <Stat icon={AudioLines} value={stemCount} label={stemCount === 1 ? 'stem' : 'stems'}/>
          <Stat icon={Users} value={contributorCount}
            label={contributorCount === 0 ? 'just you' : (contributorCount === 1 ? 'collaborator' : 'collaborators')}/>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <Button variant="brand" size="lg" onClick={onResume}>
            Resume
            <ArrowUpRight/>
          </Button>
          <Button variant="outline" size="lg" className="rounded-full bg-transparent" onClick={onOpenStudio}>
            <Mic2 style={{ color: 'var(--brand)' }}/>
            Open in Studio
          </Button>
        </div>
      </div>
    </section>
  )
}
