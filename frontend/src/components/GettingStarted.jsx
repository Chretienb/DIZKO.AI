import React from 'react'
import { C } from './ui/index.jsx'
import { checklistState } from '../lib/onboarding.js'

const Check = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20,6 9,17 4,12"/>
  </svg>
)

/**
 * Getting-started checklist card. Steps + completion live in App (`steps` =
 * label/action, `done` = index→bool from the dizko:checklist events); this just
 * renders progress and routes each step's CTA. Hidden once everything's done.
 */
export default function GettingStarted({ steps, done, onDismiss }) {
  const { completed, total, allDone, nextIndex } = checklistState(done, steps.length)
  if (allDone) return null

  return (
    <div role="region" aria-label="Getting started"
      style={{ marginBottom:20, borderRadius:16, border:`1px solid ${C.border}`, background:C.surface,
        padding:'18px 20px', boxShadow:'0 2px 12px rgba(0,0,0,.12)' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>Get set up</div>
          <div style={{ fontSize:12.5, color:C.t3, marginTop:2 }}>{completed} of {total} done — finish to make the most of Dizko.</div>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss getting started"
          style={{ width:26, height:26, borderRadius:7, flexShrink:0, background:'transparent',
            border:`1px solid ${C.border}`, cursor:'pointer', color:C.t3, display:'flex',
            alignItems:'center', justifyContent:'center' }}
          onMouseEnter={e=>{ e.currentTarget.style.background='var(--surface-2)'; e.currentTarget.style.color=C.t1 }}
          onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; e.currentTarget.style.color=C.t3 }}>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* Progress bar */}
      <div aria-hidden="true" style={{ height:5, borderRadius:100, background:'rgba(var(--fg),.08)', overflow:'hidden', marginBottom:16 }}>
        <div style={{ height:'100%', width:`${(completed/total)*100}%`, background:C.grad, borderRadius:100, transition:'width .3s' }}/>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {steps.map((s, i) => {
          const isDone = !!(done || {})[i]
          const isNext = i === nextIndex
          return (
            <div key={s.label} style={{ display:'flex', alignItems:'center', gap:11 }}>
              <span aria-hidden="true" style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, display:'flex',
                alignItems:'center', justifyContent:'center',
                background: isDone ? '#22c55e' : 'transparent',
                border: isDone ? 'none' : `1.5px solid ${C.border}` }}>
                {isDone && <Check/>}
              </span>
              <span style={{ flex:1, fontSize:13.5, fontWeight: isNext ? 700 : 500,
                color: isDone ? C.t3 : C.t1, textDecoration: isDone ? 'line-through' : 'none' }}>
                {s.label}
              </span>
              {!isDone && (
                <button onClick={s.action}
                  style={{ flexShrink:0, height:30, padding:'0 14px', borderRadius:8, cursor:'pointer', fontFamily:'inherit',
                    fontSize:12.5, fontWeight:700, border:'none',
                    background: isNext ? C.coral : 'rgba(var(--fg),.06)',
                    color: isNext ? '#fff' : C.t1, transition:'all .12s' }}>
                  {s.cta || 'Do it'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
