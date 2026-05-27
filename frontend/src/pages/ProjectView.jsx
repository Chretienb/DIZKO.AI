import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi, collaborators as collabsApi, messagesApi } from '../lib/api.js'
import { Avatar, Spinner, Btn, C } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'
import musicIcon from '../assets/music.png'

const INST_COLORS = {
  vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', guitar:'#f59e0b',
  keys:'#6366f1', synth:'#6366f1', harmony:'#ec4899', other:C.amber,
  recording:C.coral, demo:'#64748b',
}
const ic = i => INST_COLORS[i] || '#94a3b8'

// ── Inline rename ─────────────────────────────────────────────────────────────
function InlineRename({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30) }, [])
  const submit = () => { if (val.trim()) onSave(val.trim()); else onCancel() }
  return (
    <input ref={ref} value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      onBlur={submit}
      onClick={e => e.stopPropagation()}
      style={{ flex:1, fontSize:13, fontWeight:600, color:'#111', background:'#fff',
        border:`1.5px solid ${C.coral}`, borderRadius:6, outline:'none',
        padding:'2px 8px', fontFamily:'inherit', minWidth:0 }}/>
  )
}

// ── File tile ─────────────────────────────────────────────────────────────────
function FileRow({ file, onPlay, onRename, dragging, onDragStart, onDragEnd }) {
  const [hovered,  setHovered]  = useState(false)
  const [renaming, setRenaming] = useState(false)

  const notes = (() => { try { return JSON.parse(file.notes || '{}') } catch { return {} } })()
  const color = ic(file.instrument)
  const label = file.suggested_name || file.original_name || 'Untitled'
  const bpm   = notes.bpm ? `${Math.round(notes.bpm)} BPM` : null
  const key   = notes.key || null
  const meta  = [bpm, key].filter(Boolean).join(' · ')

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:'flex', flexDirection:'column', alignItems:'center', gap:6,
        cursor: dragging ? 'grabbing' : 'grab',
        opacity: dragging ? .4 : 1,
        padding:'8px 6px', borderRadius:12,
        background: hovered ? 'rgba(0,0,0,.04)' : 'transparent',
        transition:'background .12s', userSelect:'none',
      }}>

      {/* Tile — matches the Apple Music icon style */}
      <div style={{ position:'relative', width:72, height:72,
        flexShrink:0, flexGrow:0 }}>
        <div style={{
          width:72, height:72,
          borderRadius:16,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow: hovered
            ? `0 8px 24px rgba(0,0,0,.28)`
            : `0 3px 10px rgba(0,0,0,.15)`,
          transition:'box-shadow .15s',
          overflow:'hidden', position:'relative',
        }}>
          <img src={musicIcon} alt="" style={{ width:44, height:44, objectFit:'contain', position:'relative', zIndex:1 }}/>

          {/* Subtle color tint */}
          <div style={{ position:'absolute', inset:0,
            background:`radial-gradient(circle at 70% 20%, ${color}35 0%, transparent 60%)`,
            pointerEvents:'none' }}/>

          {/* Play on hover */}
          {hovered && (
            <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)',
              display:'flex', alignItems:'center', justifyContent:'center', borderRadius:16 }}>
              <button onClick={e => { e.stopPropagation(); onPlay(file) }} aria-label="Play"
                style={{ width:36, height:36, borderRadius:'50%', border:'none',
                  background:'#fff', cursor:'pointer', display:'flex', alignItems:'center',
                  justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,.4)',
                  transition:'transform .1s' }}
                onMouseEnter={e => e.currentTarget.style.transform='scale(1.1)'}
                onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill={color} style={{ marginLeft:2 }}>
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Name — click to rename */}
      {renaming ? (
        <div style={{ width:'100%' }} onClick={e => e.stopPropagation()}>
          <InlineRename value={label}
            onSave={name => { setRenaming(false); onRename(file.id, name) }}
            onCancel={() => setRenaming(false)}/>
        </div>
      ) : (
        <p
          onDoubleClick={e => { e.stopPropagation(); setRenaming(true) }}
          style={{ margin:0, fontSize:11.5, fontWeight:600, color:'#111',
            width:'100%', textAlign:'center', letterSpacing:'-.1px', lineHeight:1.35,
            display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical',
            overflow:'hidden', cursor:'default', wordBreak:'break-word' }}
          title={`${label} — double-click to rename`}>
          {label}
        </p>
      )}

      {/* Meta + play row */}
      {!renaming && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, width:'100%' }}>
          {meta && (
            <p style={{ margin:0, fontSize:9.5, color:'#bbb', fontWeight:500,
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {meta}
            </p>
          )}
          <button
            onClick={e => { e.stopPropagation(); onPlay(file) }}
            aria-label="Play"
            style={{ width:18, height:18, borderRadius:'50%', border:'none', flexShrink:0,
              background:color, cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', transition:'transform .1s, opacity .1s',
              opacity:.75 }}
            onMouseEnter={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.transform='scale(1.15)' }}
            onMouseLeave={e => { e.currentTarget.style.opacity='.75'; e.currentTarget.style.transform='scale(1)' }}>
            <svg width={7} height={7} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}>
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Folder sidebar item ───────────────────────────────────────────────────────
function FolderRow({ folder, active, count, onSelect, onRename, onDelete, onDrop, draggingId }) {
  const [editing,  setEditing]  = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [menu,     setMenu]     = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menu) return
    const close = e => { if (!menuRef.current?.contains(e.target)) setMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div
      onDragOver={e => { if (draggingId) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); if (draggingId) onDrop(folder.id) }}
      style={{ borderRadius:9, transition:'all .12s',
        background: dragOver ? `${C.coral}10` : active ? `${C.coral}08` : 'transparent',
        border: `1.5px solid ${dragOver ? C.coral : active ? `${C.coral}25` : 'transparent'}`,
      }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', cursor:'pointer' }}
        onClick={() => { if (!editing) onSelect(folder.id) }}>

        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={active || dragOver ? C.coral : '#c0c4cc'}
          strokeWidth={2} strokeLinecap="round" style={{ flexShrink:0 }}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>

        {editing ? (
          <div style={{ flex:1 }} onClick={e => e.stopPropagation()}>
            <InlineRename value={folder.name}
              onSave={n => { setEditing(false); if (n.trim()) onRename(folder.id, n.trim()) }}
              onCancel={() => setEditing(false)}/>
          </div>
        ) : (
          <span style={{ flex:1, fontSize:13, fontWeight: active ? 700 : 500,
            color: active ? C.coral : '#555',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {folder.name}
          </span>
        )}

        <span style={{ fontSize:10.5, color:'#c8ccd4', fontWeight:600, flexShrink:0 }}>{count}</span>

        {/* Menu */}
        <div ref={menuRef} style={{ position:'relative', flexShrink:0 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenu(v => !v)}
            style={{ width:20, height:20, borderRadius:5, background:'none', border:'none',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              color:'#c0c4cc', opacity: menu ? 1 : 0, transition:'opacity .1s',
              fontSize:12, letterSpacing:2 }}>
            ···
          </button>
          {menu && (
            <div style={{ position:'absolute', right:0, top:'110%', zIndex:300,
              background:'#fff', borderRadius:11, boxShadow:'0 8px 32px rgba(0,0,0,.12)',
              border:'1px solid rgba(0,0,0,.07)', overflow:'hidden', minWidth:130 }}>
              {[
                { label:'Rename', col:'#444', d:'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', fn:() => { setMenu(false); setEditing(true) } },
                { label:'Delete',  col:'#ef4444', d:'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', fn:() => { setMenu(false); onDelete(folder.id) } },
              ].map(item => (
                <button key={item.label} onClick={item.fn}
                  style={{ width:'100%', padding:'10px 14px', background:'none', border:'none',
                    cursor:'pointer', textAlign:'left', fontSize:13, color:item.col,
                    display:'flex', alignItems:'center', gap:8 }}
                  onMouseEnter={e => e.currentTarget.style.background = item.col==='#ef4444'?'#fef2f2':'#f8f8f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
                    stroke={item.col} strokeWidth={2} strokeLinecap="round"><path d={item.d}/></svg>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Message modal ─────────────────────────────────────────────────────────────
function MessageModal({ collab, onClose, onSend }) {
  const [text,    setText]    = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const ref = useRef(null)
  const _em = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (_em ? _em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')

  useEffect(() => { setTimeout(() => ref.current?.focus(), 60) }, [])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    await onSend(collab, text.trim())
    setSending(false)
    setSent(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:20, padding:'28px', width:400,
        maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.2)' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <div style={{ width:44, height:44, borderRadius:'50%', background:`${C.coral}15`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, fontWeight:800, color:C.coral, flexShrink:0 }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:800, color:'#111', letterSpacing:'-.3px' }}>{name}</p>
            <p style={{ margin:0, fontSize:12, color:'#aaa' }}>{collab.role || 'Collaborator'}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer',
            color:'#ccc', fontSize:20, lineHeight:1, padding:0, transition:'color .12s' }}
            onMouseEnter={e=>e.currentTarget.style.color='#555'}
            onMouseLeave={e=>e.currentTarget.style.color='#ccc'}>×</button>
        </div>

        {sent ? (
          <div style={{ textAlign:'center', padding:'12px 0' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>✓</div>
            <p style={{ margin:0, fontSize:14, fontWeight:600, color:'#22c55e' }}>Message sent!</p>
          </div>
        ) : (
          <>
            <textarea ref={ref} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) send(); if (e.key === 'Escape') onClose() }}
              placeholder={`Send ${name.split(' ')[0]} a message…`}
              rows={4}
              style={{ width:'100%', padding:'12px 14px', borderRadius:12, resize:'none',
                border:'1.5px solid rgba(0,0,0,.1)', fontSize:14, fontFamily:'inherit',
                outline:'none', boxSizing:'border-box', lineHeight:1.6, color:'#111',
                transition:'border-color .12s' }}
              onFocus={e => e.target.style.borderColor=C.coral}
              onBlur={e => e.target.style.borderColor='rgba(0,0,0,.1)'}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12 }}>
              <span style={{ fontSize:11, color:'#ccc' }}>⌘ + Enter to send</span>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={onClose}
                  style={{ height:36, padding:'0 16px', borderRadius:10,
                    border:'1.5px solid rgba(0,0,0,.1)', background:'none',
                    fontSize:13, fontWeight:600, color:'#666', cursor:'pointer' }}>
                  Cancel
                </button>
                <button onClick={send} disabled={!text.trim() || sending}
                  style={{ height:36, padding:'0 18px', borderRadius:10, border:'none',
                    background: text.trim() ? C.grad : 'rgba(0,0,0,.07)',
                    color: text.trim() ? '#fff' : '#ccc',
                    fontSize:13, fontWeight:700, cursor: text.trim() ? 'pointer' : 'default',
                    transition:'all .15s', boxShadow: text.trim() ? `0 4px 12px ${C.coral}40` : 'none' }}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Remove confirm modal ──────────────────────────────────────────────────────
function RemoveModal({ collab, onClose, onConfirm }) {
  const _em = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (_em ? _em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.4)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:20, padding:'28px', width:360,
        maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.2)', textAlign:'center' }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:'#fef2f2',
          margin:'0 auto 16px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </div>
        <p style={{ margin:'0 0 6px', fontSize:17, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>
          Remove {name}?
        </p>
        <p style={{ margin:'0 0 24px', fontSize:13, color:'#888', lineHeight:1.6 }}>
          They will lose access to this project and all its files. This cannot be undone.
        </p>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, height:40, borderRadius:11, border:'1.5px solid rgba(0,0,0,.1)',
              background:'none', fontSize:14, fontWeight:600, color:'#666', cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={() => { onConfirm(); onClose() }}
            style={{ flex:1, height:40, borderRadius:11, border:'none',
              background:'#ef4444', color:'#fff', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 4px 12px rgba(239,68,68,.35)' }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Collaborators panel ───────────────────────────────────────────────────────
function CollaboratorsPanel({ collabs, onInvite, onRemove, onMessage }) {
  const [msgCollab,    setMsgCollab]    = useState(null)
  const [removeCollab, setRemoveCollab] = useState(null)
  const COLORS = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b', '#6366f1']

  return (
    <>
      <div style={{ background:'#fff', borderRadius:14, padding:'16px',
        border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <p style={{ margin:0, fontSize:10, fontWeight:800, color:'#c0c4cc',
            textTransform:'uppercase', letterSpacing:'.1em' }}>
            Team {collabs.length > 0 && <span style={{ color:'#aaa', fontWeight:600 }}>({collabs.length})</span>}
          </p>
          <button onClick={onInvite}
            style={{ height:26, padding:'0 10px', borderRadius:100, fontSize:11, fontWeight:700,
              color:C.coral, background:`${C.coral}10`, border:`1px solid ${C.coral}30`,
              cursor:'pointer', transition:'all .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background=`${C.coral}20`}
            onMouseLeave={e=>e.currentTarget.style.background=`${C.coral}10`}>
            + Invite
          </button>
        </div>

        {collabs.length === 0 ? (
          <div style={{ textAlign:'center', padding:'12px 0' }}>
            <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:600, color:'#ccc' }}>No one yet</p>
            <p style={{ margin:0, fontSize:11.5, color:'#d8dce4' }}>Invite collaborators to get started</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {collabs.map((c, i) => {
              const rawEmail = c.user?.email || c.email || ''
              const name  = c.user?.full_name
                || (rawEmail ? rawEmail.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
              const color = COLORS[i % COLORS.length]
              const initials = name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() || '?'

              return (
                <div key={c.id}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'8px',
                    borderRadius:10, transition:'background .1s', cursor:'default' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.03)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>

                  {/* Avatar */}
                  <div style={{ width:36, height:36, borderRadius:'50%', background:`${color}18`,
                    flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight:800, color, border:`1.5px solid ${color}25` }}>
                    {initials || '?'}
                  </div>

                  {/* Name + email */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:'0 0 1px', fontSize:13, fontWeight:700, color:'#111',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
                    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ fontSize:10, fontWeight:600, color:'#bbb',
                        textTransform:'capitalize' }}>{c.role || 'Collaborator'}</span>
                      <span style={{ fontSize:9, color:'#e0e0e0' }}>·</span>
                      <span style={{ fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:100,
                        background: c.status==='active' ? '#22c55e12' : 'rgba(0,0,0,.04)',
                        color: c.status==='active' ? '#22c55e' : '#ccc' }}>
                        {c.status==='active' ? 'Active' : 'Pending'}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display:'flex', gap:4, flexShrink:0, opacity:0, transition:'opacity .15s' }}
                    className="collab-actions">
                    {c.user_id && (
                      <button onClick={() => setMsgCollab(c)}
                        aria-label="Message"
                        style={{ width:28, height:28, borderRadius:8, border:'1px solid rgba(0,0,0,.1)',
                          background:'#fff', cursor:'pointer', display:'flex', alignItems:'center',
                          justifyContent:'center', color:'#aaa', transition:'all .12s' }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=C.coral;e.currentTarget.style.color=C.coral;e.currentTarget.style.background=`${C.coral}08`}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,0,0,.1)';e.currentTarget.style.color='#aaa';e.currentTarget.style.background='#fff'}}>
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                      </button>
                    )}
                    <button onClick={() => setRemoveCollab(c)}
                      aria-label="Remove"
                      style={{ width:28, height:28, borderRadius:8, border:'1px solid rgba(0,0,0,.1)',
                        background:'#fff', cursor:'pointer', display:'flex', alignItems:'center',
                        justifyContent:'center', color:'#aaa', transition:'all .12s' }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';e.currentTarget.style.background='#fef2f2'}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,0,0,.1)';e.currentTarget.style.color='#aaa';e.currentTarget.style.background='#fff'}}>
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <line x1="23" y1="11" x2="17" y2="11"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {msgCollab && (
        <MessageModal collab={msgCollab}
          onClose={() => setMsgCollab(null)}
          onSend={onMessage}/>
      )}
      {removeCollab && (
        <RemoveModal collab={removeCollab}
          onClose={() => setRemoveCollab(null)}
          onConfirm={() => onRemove(removeCollab)}/>
      )}

      <style>{`
        div:hover > div > .collab-actions { opacity: 1 !important; }
      `}</style>
    </>
  )
}

// ── Activity item ─────────────────────────────────────────────────────────────
function ActivityItem({ item }) {
  const name   = item.actor_name || item.title?.split(' ')?.[0] || '?'
  const colors = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b']
  const color  = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{ display:'flex', gap:9, alignItems:'flex-start',
      padding:'8px 0', borderBottom:'1px solid rgba(0,0,0,.04)' }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:`${color}15`,
        flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:11, fontWeight:800, color }}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex:1, minWidth:0, paddingTop:2 }}>
        <p style={{ margin:'0 0 2px', fontSize:12, color:'#555', lineHeight:1.5 }}>
          {item.body || item.message || item.title}
        </p>
        <span style={{ fontSize:10.5, color:'#c0c4cc' }}>{timeAgo(item.created_at)}</span>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProjectView({ openModal, playTrack, addToast, user }) {
  const { id: projectId } = useParams()
  const navigate          = useNavigate()
  const isMobile          = React.useContext(MobileCtx)

  const [project,        setProject]        = useState(null)
  const [files,          setFiles]          = useState([])
  const [folders,        setFolders]        = useState([])
  const [activity,       setActivity]       = useState([])
  const [collabs,        setCollabs]        = useState([])
  const [selectedFolder, setSelectedFolder] = useState('all')
  const [loading,        setLoading]        = useState(true)
  const [draggingId,     setDraggingId]     = useState(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName,  setNewFolderName]  = useState('New Folder')
  const [search,         setSearch]         = useState('')
  const newFolderRef = useRef(null)

  const loadAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projRes, foldersRes, collabsRes] = await Promise.all([
        projectsApi.get(projectId),
        foldersApi.list(projectId),
        collabsApi.listByProject(projectId).catch(() => ({ data: [] })),
      ])
      setCollabs(collabsRes.data || [])
      setProject(projRes.data)
      setFolders(foldersRes.data || [])
      const filesRes = await filesApi.list(projectId)
      setFiles((filesRes.data || []).filter(f =>
        f.instrument !== 'smart_bounce' && f.instrument !== 'original'
      ))
      try {
        const r = await fetch(`/api/notifications?project_id=${projectId}&limit=20`, {
          credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` },
        })
        const j = await r.json().catch(() => ({}))
        // Only show human activity — exclude internal AI analysis entries
        setActivity((j.data || []).filter(n => n.type !== 'ai_analysis'))
      } catch {}
    } catch {
      addToast?.('Failed to load project', { type:'error' })
    } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (creatingFolder)
      setTimeout(() => { newFolderRef.current?.focus(); newFolderRef.current?.select() }, 40)
  }, [creatingFolder])

  const createFolder = async () => {
    const name = newFolderName.trim() || 'New Folder'
    setCreatingFolder(false); setNewFolderName('New Folder')
    try {
      const res = await foldersApi.create(projectId, name)
      if (res.data) setFolders(prev => [...prev, res.data])
    } catch {}
  }

  const renameFolder = async (id, name) => {
    setFolders(prev => prev.map(f => f.id === id ? {...f, name} : f))
    try { await foldersApi.rename(id, name) } catch {}
  }

  const deleteFolder = async (id) => {
    setFolders(prev => prev.filter(f => f.id !== id))
    setFiles(prev => prev.map(f => f.folder_id === id ? {...f, folder_id:null} : f))
    if (selectedFolder === id) setSelectedFolder('all')
    try { await foldersApi.remove(id) } catch {}
  }

  const moveFile = async (stemId, folderId) => {
    if (!stemId) return
    // Optimistic update
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, folder_id: folderId || null} : f))
    try {
      await foldersApi.moveFile(stemId, folderId)
    } catch (e) {
      console.warn('[moveFile]', e?.message)
      // Revert on failure
      loadAll()
    }
  }

  const renameFile = async (stemId, name) => {
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, suggested_name: name} : f))
    try {
      await fetch(`/api/files/${stemId}`, {
        method:'PATCH', credentials:'include',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` },
        body: JSON.stringify({ suggested_name: name }),
      })
    } catch {}
  }

  const baseFiles = selectedFolder === 'all' ? files
    : selectedFolder === 'unfiled' ? files.filter(f => !f.folder_id)
    : files.filter(f => f.folder_id === selectedFolder)

  const visibleFiles = search
    ? baseFiles.filter(f =>
        (f.suggested_name||f.original_name||'').toLowerCase().includes(search.toLowerCase()) ||
        (f.instrument||'').toLowerCase().includes(search.toLowerCase())
      )
    : baseFiles

  const folderCount = id =>
    id === 'all'     ? files.length :
    id === 'unfiled' ? files.filter(f => !f.folder_id).length :
    files.filter(f => f.folder_id === id).length

  const instruments = Object.entries(
    files.reduce((a, f) => { const k = f.instrument||'other'; a[k]=(a[k]||0)+1; return a }, {})
  ).sort((a,b) => b[1]-a[1])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh',
      flexDirection:'column', gap:12 }}>
      <Spinner size={28}/>
      <p style={{ margin:0, fontSize:13, color:'#bbb' }}>Loading project…</p>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
          <button onClick={() => navigate('/projects')}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#bbb',
              fontSize:12.5, fontWeight:600, padding:0, display:'flex', alignItems:'center',
              gap:4, transition:'color .12s' }}
            onMouseEnter={e => e.currentTarget.style.color='#555'}
            onMouseLeave={e => e.currentTarget.style.color='#bbb'}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.5} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
            Projects
          </button>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>
          <span style={{ fontSize:12.5, color:'#aaa' }}>{project?.title||'…'}</span>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#111',
            letterSpacing:'-1px', flex:1 }}>{project?.title || 'Project'}</h1>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => openModal?.('invite', { project })}
              style={{ height:34, padding:'0 14px', borderRadius:9,
                border:'1.5px solid rgba(0,0,0,.1)', background:'#fff',
                fontSize:12.5, fontWeight:600, color:'#666', cursor:'pointer',
                display:'flex', alignItems:'center', gap:6, transition:'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#666' }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={2} strokeLinecap="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
              Invite
            </button>
            <Btn onClick={() => openModal?.('upload', { project })}>+ Upload</Btn>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div style={{ display:'grid',
        gridTemplateColumns: isMobile ? '1fr' : '200px 1fr 210px',
        gap:20, alignItems:'start' }}>

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>

          {/* All files */}
          {['all'].map(() => (
            <div key="all"
              onDragOver={e => { if (draggingId) e.preventDefault() }}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, null); setDraggingId(null) }}
              onClick={() => setSelectedFolder('all')}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                borderRadius:9, cursor:'pointer', transition:'all .12s',
                background: selectedFolder==='all' ? `${C.coral}10` : 'transparent',
                border:`1.5px solid ${selectedFolder==='all'?`${C.coral}25`:'transparent'}` }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke={selectedFolder==='all'?C.coral:'#c0c4cc'} strokeWidth={2} strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span style={{ flex:1, fontSize:13, fontWeight:selectedFolder==='all'?700:500,
                color:selectedFolder==='all'?C.coral:'#555' }}>All Files</span>
              <span style={{ fontSize:11, color:'#c8ccd4', fontWeight:600 }}>{folderCount('all')}</span>
            </div>
          ))}

          {/* Folders */}
          {(folders.length > 0 || creatingFolder) && (
            <div style={{ marginTop:12 }}>
              <p style={{ margin:'0 0 6px 10px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Folders</p>
              <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                {folders.map(f => (
                  <FolderRow key={f.id} folder={f}
                    active={selectedFolder===f.id}
                    count={folderCount(f.id)}
                    draggingId={draggingId}
                    onSelect={setSelectedFolder}
                    onRename={renameFolder}
                    onDelete={deleteFolder}
                    onDrop={id => { moveFile(draggingId, id); setDraggingId(null) }}/>
                ))}
              </div>
            </div>
          )}

          {/* New folder */}
          <div style={{ marginTop:6 }}>
            {creatingFolder ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                borderRadius:9, background:`${C.coral}06`, border:`1.5px solid ${C.coral}30` }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                  stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <input ref={newFolderRef} value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter') createFolder(); if(e.key==='Escape'){setCreatingFolder(false);setNewFolderName('New Folder')} }}
                  onBlur={createFolder}
                  style={{ flex:1, fontSize:13, fontWeight:600, background:'transparent', border:'none',
                    borderBottom:`1.5px solid ${C.coral}`, outline:'none', color:'#111', fontFamily:'inherit' }}/>
              </div>
            ) : (
              <button onClick={() => setCreatingFolder(true)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px',
                  borderRadius:9, background:'none', border:'1.5px dashed rgba(0,0,0,.1)',
                  cursor:'pointer', fontSize:12.5, fontWeight:600, color:'#c0c4cc',
                  transition:'all .15s', width:'100%' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral; e.currentTarget.style.background=`${C.coral}06` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#c0c4cc'; e.currentTarget.style.background='none' }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.5} strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Folder
              </button>
            )}
          </div>

          {/* Unfiled */}
          {files.some(f => !f.folder_id) && folders.length > 0 && (
            <div key="unfiled"
              onDragOver={e => { if (draggingId) e.preventDefault() }}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, null); setDraggingId(null) }}
              onClick={() => setSelectedFolder('unfiled')}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                borderRadius:9, cursor:'pointer', transition:'all .12s', marginTop:4,
                background: selectedFolder==='unfiled' ? 'rgba(0,0,0,.04)' : 'transparent',
                border:`1.5px solid ${selectedFolder==='unfiled'?'rgba(0,0,0,.1)':'transparent'}` }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke="#c0c4cc" strokeWidth={2} strokeLinecap="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#aaa' }}>Unfiled</span>
              <span style={{ fontSize:11, color:'#c8ccd4', fontWeight:600 }}>{folderCount('unfiled')}</span>
            </div>
          )}

          {/* Activity — always shown */}
          <div style={{ marginTop:20 }}>
            <p style={{ margin:'0 0 8px 2px', fontSize:10, fontWeight:800, color:'#c0c4cc',
              textTransform:'uppercase', letterSpacing:'.1em' }}>Recent Activity</p>
            {activity.length > 0 ? (
              activity.slice(0,8).map((n,i) => <ActivityItem key={n.id||i} item={n}/>)
            ) : (
              <div style={{ padding:'14px 0', textAlign:'center' }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none"
                  stroke="#e0e0e0" strokeWidth={1.5} strokeLinecap="round"
                  style={{ marginBottom:8, display:'block', margin:'0 auto 8px' }}>
                  <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <p style={{ margin:0, fontSize:11.5, color:'#d0d0d8', fontWeight:500, lineHeight:1.5 }}>
                  No activity yet.<br/>Uploads and invites will show here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Files list ────────────────────────────────────────────── */}
        <div>
          {/* Search bar */}
          <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center' }}>
            <div style={{ flex:1, position:'relative' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#c0c4cc"
                strokeWidth={2} strokeLinecap="round"
                style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search files…"
                style={{ width:'100%', height:34, paddingLeft:34, paddingRight:12,
                  borderRadius:9, border:'1.5px solid rgba(0,0,0,.08)', background:'#fff',
                  fontSize:13, color:'#111', outline:'none', boxSizing:'border-box',
                  fontFamily:'inherit', transition:'border-color .12s' }}
                onFocus={e => e.target.style.borderColor=C.coral}
                onBlur={e => e.target.style.borderColor='rgba(0,0,0,.08)'}/>
            </div>
            <span style={{ fontSize:12, color:'#c0c4cc', flexShrink:0, fontWeight:500 }}>
              {visibleFiles.length} file{visibleFiles.length!==1?'s':''}
            </span>
          </div>

          {/* Drop hint when dragging */}
          {draggingId && (
            <div style={{ padding:'10px 14px', borderRadius:10, border:`1.5px dashed ${C.coral}`,
              background:`${C.coral}06`, textAlign:'center', fontSize:12.5, fontWeight:600,
              color:C.coral, marginBottom:12 }}>
              Drag onto a folder in the sidebar to move
            </div>
          )}

          {visibleFiles.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              padding:'60px 24px', borderRadius:16,
              border:'2px dashed rgba(0,0,0,.07)', background:'#fafafa' }}>
              <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}10`,
                border:`1.5px dashed ${C.coral}40`, display:'flex', alignItems:'center',
                justifyContent:'center', marginBottom:14 }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke={C.coral} strokeWidth={1.5} strokeLinecap="round" style={{ opacity:.7 }}>
                  <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                </svg>
              </div>
              <div style={{ fontSize:14, fontWeight:700, color:'#bbb', marginBottom:6 }}>
                {search ? 'No files match' : 'No files here yet'}
              </div>
              {selectedFolder === 'all' && !search && (
                <Btn onClick={() => openModal?.('upload', { project })}>+ Upload First Stem</Btn>
              )}
            </div>
          ) : (
            <div style={{ display:'grid',
              gridTemplateColumns:'repeat(auto-fill, minmax(90px, 1fr))',
              gap:2 }}>
              {visibleFiles.map(file => (
                <FileRow key={file.id} file={file}
                  dragging={draggingId === file.id}
                  onPlay={playTrack}
                  onRename={renameFile}
                  onDragStart={() => setDraggingId(file.id)}
                  onDragEnd={() => setDraggingId(null)}/>
              ))}
            </div>
          )}
        </div>

        {/* ── Right stats ───────────────────────────────────────────── */}
        {!isMobile && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            <div style={{ background:'#fff', borderRadius:14, padding:'16px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Session</p>
              {[
                { label:'Files',   val:files.length },
                { label:'Folders', val:folders.length },
              ].map(s => (
                <div key={s.label} style={{ display:'flex', alignItems:'center',
                  padding:'7px 0', borderBottom:'1px solid rgba(0,0,0,.04)' }}>
                  <span style={{ flex:1, fontSize:13, color:'#888' }}>{s.label}</span>
                  <span style={{ fontSize:18, fontWeight:900, color:'#111',
                    letterSpacing:'-1px' }}>{s.val}</span>
                </div>
              ))}
            </div>

            {instruments.length > 0 && (
              <div style={{ background:'#fff', borderRadius:14, padding:'16px',
                border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
                <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                  textTransform:'uppercase', letterSpacing:'.1em' }}>Breakdown</p>

                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {instruments.map(([inst, count]) => (
                    <div key={inst} style={{ display:'flex', alignItems:'center', gap:5,
                      padding:'4px 10px', borderRadius:100,
                      background:`${ic(inst)}10`, border:`1px solid ${ic(inst)}25` }}>
                      <div style={{ width:6, height:6, borderRadius:'50%', background:ic(inst) }}/>
                      <span style={{ fontSize:11.5, fontWeight:700, color:ic(inst),
                        textTransform:'capitalize' }}>{inst}</span>
                      <span style={{ fontSize:11, fontWeight:600, color:ic(inst), opacity:.6 }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collaborators */}
            <CollaboratorsPanel
              collabs={collabs}
              project={project}
              onInvite={() => openModal?.('invite', { project })}
              onRemove={async (collab) => {
                setCollabs(prev => prev.filter(c => c.id !== collab.id))
                try { await collabsApi.remove(collab.id) } catch { loadAll() }
              }}
              onMessage={async (collab, text) => {
                if (!collab.user_id) return
                try { await messagesApi.send(collab.user_id, text) } catch {}
              }}
            />

            <div style={{ background:'#fff', borderRadius:14, padding:'16px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Quick Actions</p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  { label:'Open Studio', icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z', fn:() => navigate('/studio') },
                  { label:'Invite Collaborator', icon:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 3v18M3 12h18', fn:() => openModal?.('invite', {project}) },
                  { label:'Upload Files', icon:'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', fn:() => openModal?.('upload', {project}) },
                ].map(a => (
                  <button key={a.label} onClick={a.fn}
                    style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                      borderRadius:9, border:'1px solid rgba(0,0,0,.07)', background:'rgba(0,0,0,.02)',
                      cursor:'pointer', textAlign:'left', fontSize:12.5, fontWeight:600,
                      color:'#555', transition:'all .12s', width:'100%' }}
                    onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}08`; e.currentTarget.style.borderColor=`${C.coral}30`; e.currentTarget.style.color=C.coral }}
                    onMouseLeave={e => { e.currentTarget.style.background='rgba(0,0,0,.02)'; e.currentTarget.style.borderColor='rgba(0,0,0,.07)'; e.currentTarget.style.color='#555' }}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d={a.icon}/>
                    </svg>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        div:hover > div > button[aria-label] { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
