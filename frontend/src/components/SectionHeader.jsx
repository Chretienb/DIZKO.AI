import React from 'react'

// Editorial section header — mono eyebrow over a Geist title, optional
// action slot on the right. One component so every page's sections carry
// the same rhythm.
export default function SectionHeader({ eyebrow, title, action, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, ...style }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, letterSpacing: '.14em',
            textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 6 }}>
            {eyebrow}
          </div>
        )}
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-.4px', color: 'var(--t1)' }}>{title}</h2>
      </div>
      {action}
    </div>
  )
}
