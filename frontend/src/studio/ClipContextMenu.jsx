import React from 'react'
import { createPortal } from 'react-dom'
import { C } from '../components/ui/index.jsx'

// Same accent palette used elsewhere for stem/track colors (Studio.jsx's
// defaultColors) — kept here too so the picker doesn't need a prop just to
// stay in sync with a rarely-changing constant.
const COLOR_SWATCHES = [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink]

const Icon = ({ children }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink:0 }}>
    {children}
  </svg>
)
const DuplicateIcon = () => <Icon><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></Icon>
const RenameIcon    = () => <Icon><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></Icon>
const TrashIcon      = () => <Icon><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></Icon>
const ScissorsIcon    = () => <Icon><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></Icon>
const TrimStartIcon   = () => <Icon><line x1="4" y1="4" x2="4" y2="20"/><polyline points="10,8 14,12 10,16"/><line x1="14" y1="12" x2="21" y2="12"/></Icon>
const TrimEndIcon     = () => <Icon><line x1="20" y1="4" x2="20" y2="20"/><polyline points="14,8 10,12 14,16"/><line x1="10" y1="12" x2="3" y2="12"/></Icon>
const BackIcon        = () => <Icon><path d="M15 18l-6-6 6-6"/></Icon>
// A thin ring stands in for a generic "palette" icon — same visual weight as
// the stroke-line icons beside it (not a bold filled blob), while still
// previewing the clip's current color as the ring's tint.
const ColorDot = ({ hex }) => (
  <span aria-hidden="true" style={{ width:14, height:14, borderRadius:'50%', flexShrink:0, boxSizing:'border-box',
    border:`1.8px solid ${hex || C.t3}`, background: hex ? `${hex}1f` : 'transparent' }}/>
)

// Right-click (desktop) / long-press (touch) menu for one clip — Duplicate,
// Split (cut in two at the playhead), Delete, Rename, and Color (the latter
// two rename/recolor the underlying STEM, not just this one clip instance —
// every clip of that stem shares the same label and color, since they're the
// same asset placed more than once). Follows the same portal-popover pattern
// already used for ProjectPicker/SongSelector in Studio.jsx (fixed position
// at the trigger point, outside-click + Escape to close).
export default function ClipContextMenu({ x, y, currentName, currentColor, canSplit, onDuplicate, onSplit, onTrimStart, onTrimEnd, onDelete, onRename, onColor, onClose }) {
  const ref = React.useRef(null)
  const [mode, setMode] = React.useState('menu')   // 'menu' | 'rename' | 'color'
  const [name, setName] = React.useState(currentName || '')
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    const onDoc = e => { if (!ref.current?.contains(e.target)) onClose() }
    const onKey = e => { if (e.key === 'Escape') onClose() }
    // Deferred so the event that opened the menu doesn't immediately close it.
    const id = setTimeout(() => {
      document.addEventListener('mousedown', onDoc)
      document.addEventListener('touchstart', onDoc)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  React.useEffect(() => { if (mode === 'rename') inputRef.current?.focus() }, [mode])

  const item = (icon, label, onClick, { danger, disabled, title } = {}) => (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 12px', borderRadius:8, border:'none',
        background:'transparent', cursor: disabled ? 'default' : 'pointer', textAlign:'left', fontFamily:'inherit', fontSize:12.5, fontWeight:600,
        color: disabled ? C.t3 : danger ? '#ef4444' : C.t1, opacity: disabled ? .5 : 1 }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(var(--fg),.06)' }}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {icon}
      {label}
    </button>
  )

  const paneHeader = (label) => (
    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 6px 8px' }}>
      <button onClick={() => setMode('menu')} aria-label="Back"
        style={{ display:'flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6,
          border:'none', background:'transparent', cursor:'pointer', color:C.t3 }}>
        <BackIcon/>
      </button>
      <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.04em', textTransform:'uppercase', color:C.t3 }}>{label}</span>
    </div>
  )

  const submitRename = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== currentName) onRename(trimmed)
    onClose()
  }

  let body
  if (mode === 'rename') {
    // Enter already saves (and blur does too) — a big colored submit button
    // under a single text field was more chrome than the action needed.
    body = (
      <div>
        {paneHeader('Rename')}
        <div style={{ padding:'0 8px 8px' }}>
          <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') onClose() }}
            placeholder="Name"
            style={{ width:'100%', height:30, padding:'0 9px', borderRadius:7, border:`1px solid ${C.border}`,
              background:'transparent', color:C.t1, fontSize:12.5, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}/>
        </div>
      </div>
    )
  } else if (mode === 'color') {
    body = (
      <div>
        {paneHeader('Color')}
        <div style={{ padding:'0 8px 8px', display:'flex', flexWrap:'wrap', gap:8 }}>
          {COLOR_SWATCHES.map(hex => (
            <button key={hex} onClick={() => { onColor(hex); onClose() }} aria-label={`Set color ${hex}`}
              style={{ width:24, height:24, borderRadius:'50%', border: currentColor === hex ? `2px solid ${C.t1}` : '2px solid transparent',
                background:hex, cursor:'pointer', padding:0 }}/>
          ))}
          {currentColor && (
            <button onClick={() => { onColor(null); onClose() }} title="Reset to default"
              style={{ width:24, height:24, borderRadius:'50%', border:`1.5px dashed ${C.border}`, background:'transparent', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', color:C.t3, fontSize:12, padding:0 }}>
              ✕
            </button>
          )}
        </div>
      </div>
    )
  } else {
    body = (
      <>
        {item(<DuplicateIcon/>, 'Duplicate', () => { onDuplicate(); onClose() })}
        {item(<ScissorsIcon/>, 'Split', () => { onSplit(); onClose() },
          { disabled: !canSplit, title: canSplit ? 'Cut this clip in two at the playhead' : 'Move the playhead inside this clip to split it there' })}
        {/* Precision trims — the exact-cut companions to edge-dragging; same
            playhead-inside-clip requirement as Split. */}
        {item(<TrimStartIcon/>, 'Trim start to playhead', () => { onTrimStart(); onClose() },
          { disabled: !canSplit, title: canSplit ? 'Remove everything before the playhead' : 'Move the playhead inside this clip first' })}
        {item(<TrimEndIcon/>, 'Trim end to playhead', () => { onTrimEnd(); onClose() },
          { disabled: !canSplit, title: canSplit ? 'Remove everything after the playhead' : 'Move the playhead inside this clip first' })}
        {item(<RenameIcon/>, 'Rename', () => setMode('rename'))}
        {item(<ColorDot hex={currentColor}/>, 'Color', () => setMode('color'))}
        {item(<TrashIcon/>, 'Delete', () => { onDelete(); onClose() }, { danger: true })}
      </>
    )
  }

  return createPortal(
    <div ref={ref} style={{ position:'fixed', top:y, left:x, zIndex:4000, width:180,
      background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden',
      padding:5, boxShadow:'0 12px 34px rgba(0,0,0,.45)' }}>
      {body}
    </div>,
    document.body,
  )
}
