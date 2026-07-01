import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { showcaseApi, projects as projectsApi, files as filesApi, auth as authApi } from './lib/api.js'
import { C, Avatar, Spinner } from './components/ui/index.jsx'

const LINK_PRESETS = ['Spotify', 'Apple Music', 'YouTube', 'SoundCloud', 'Bandcamp', 'Instagram']

// One shared loading row — the brand equalizer spinner + label — so every
// loading state in this editor looks the same instead of bare text.
function Loading({ label = 'Loading…', pad = '40px 0' }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:pad }}>
      <Spinner size={26} />
      <span style={{ fontSize:12.5, color:C.t3 }}>{label}</span>
    </div>
  )
}

// Producer-facing editor for the public showcase profile. Claim a handle, edit
// name/bio/links, replace the photo (which updates the account pfp too), flip
// the profile public, and curate which library files appear at /u/<handle>.
// mode: 'tracks' → curate the showcase (Add tracks screen); 'profile' → edit
// identity/bio/links/visibility (Edit profile screen). Split so each lives on
// its own screen instead of one crowded editor.
export default function ProfileEditor({ user, onClose, onProfileUpdate, mode = 'tracks' }) {
  const navigate = useNavigate()
  const cached = showcaseApi.meCache()   // last snapshot → instant paint
  const [loading, setLoading]   = useState(!cached)
  const [profile, setProfile]   = useState(cached?.profile || null)
  const [items, setItems]       = useState(cached?.items || [])
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null)

  // editable fields
  const cp = cached?.profile || {}
  const [handle, setHandle]           = useState(cp.handle || '')
  const [handleState, setHandleState] = useState(null) // null | checking | ok | taken | invalid
  const [displayName, setDisplayName] = useState(cp.display_name || user?.full_name || '')
  const [bio, setBio]                 = useState(cp.bio || '')
  const [links, setLinks]             = useState(Array.isArray(cp.links) ? cp.links.join('\n') : '')
  const [avatar, setAvatar]           = useState(cp.avatar_url || user?.avatar_url || null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [isPublic, setIsPublic]       = useState(!!cp.profile_public)
  const avatarInput = useRef()

  // add-from-library picker
  const [projList, setProjList]       = useState([])
  const [projQuery, setProjQuery]     = useState('')
  const [pickProject, setPickProject] = useState('')
  const [fileQuery, setFileQuery]     = useState('')
  const [pickFiles, setPickFiles]     = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [previewId, setPreviewId]     = useState(null)   // file being previewed
  const previewAudio = useRef()

  useEffect(() => {
    const hadCache = !!cached
    showcaseApi.me().then(r => {
      // If we already painted from cache, just refresh the read-only profile
      // (stats) and leave the user's editable fields / item edits untouched —
      // me() has already refreshed the snapshot for the next open.
      const pr = r?.data?.profile || {}
      setProfile(pr)
      if (!hadCache) {
        setItems(r?.data?.items || [])
        setHandle(pr.handle || '')
        setDisplayName(pr.display_name || user?.full_name || '')
        setBio(pr.bio || '')
        setLinks(Array.isArray(pr.links) ? pr.links.join('\n') : '')
        setAvatar(pr.avatar_url || user?.avatar_url || null)
        setIsPublic(!!pr.profile_public)
      }
    }).catch(() => {}).finally(() => setLoading(false))
    projectsApi.list().then(r => setProjList(r?.data || [])).catch(() => {})
  }, [])

  // Debounced handle availability check.
  useEffect(() => {
    if (!handle || handle === profile?.handle) { setHandleState(null); return }
    setHandleState('checking')
    const t = setTimeout(() => {
      showcaseApi.checkHandle(handle)
        .then(r => setHandleState(r?.data?.available ? 'ok' : (r?.data?.reason === 'invalid' ? 'invalid' : 'taken')))
        .catch(() => setHandleState(null))
    }, 400)
    return () => clearTimeout(t)
  }, [handle])

  useEffect(() => {
    setFileQuery('')
    if (!pickProject) { setPickFiles([]); return }
    setLoadingFiles(true)
    filesApi.list(pickProject)
      .then(r => {
        const mine = (r?.data || []).filter(f => !f.uploaded_by || f.uploaded_by === user?.id)
        const already = new Set(items.map(i => i.stem_id))
        setPickFiles(mine.filter(f => !already.has(f.id)))
      })
      .catch(() => setPickFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [pickProject, items])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 2500) }

  // Preview a library file (these are the producer's own files — play directly).
  const togglePreview = (f) => {
    const el = previewAudio.current
    if (!el) return
    if (previewId === f.id) { el.pause(); setPreviewId(null); return }
    const url = f.preview_url || f.file_url
    if (!url) { flash('No preview available'); return }
    el.src = url
    el.play().then(() => setPreviewId(f.id)).catch(() => setPreviewId(null))
  }

  // Replace the profile photo — this updates the account pfp everywhere too.
  const pickAvatar = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const r = await authApi.uploadAvatar(file)
      const url = r?.data?.avatar_url
      if (url) {
        setAvatar(url)
        if (user?.id) localStorage.setItem(`disco_avatar_url:${user.id}`, url)
        localStorage.removeItem('disco_avatar_url')
        onProfileUpdate?.({ avatar_url: url })
        flash('Photo updated')
      }
    } catch (err) { flash(err.message || 'Upload failed') }
    finally { setUploadingAvatar(false); if (avatarInput.current) avatarInput.current.value = '' }
  }

  const saveHandle = async () => {
    try { await showcaseApi.setHandle(handle); setProfile(p => ({ ...p, handle })); setHandleState(null); flash('Handle saved') }
    catch (e) { flash(e.message || 'Could not save handle') }
  }

  const saveProfile = async (overrides = {}) => {
    setSaving(true)
    try {
      const patch = {
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        links: links.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8),
        ...overrides,
      }
      const r = await showcaseApi.updateProfile(patch)
      if (r?.data) setProfile(p => ({ ...p, ...r.data }))
      flash('Saved')
    } catch (e) { flash(e.message || 'Could not save'); throw e }
    finally { setSaving(false) }
  }

  const togglePublic = async () => {
    const next = !isPublic
    if (next && !profile?.handle && !handle) { flash('Claim a handle first'); return }
    setIsPublic(next)
    try { await saveProfile({ profile_public: next }) }
    catch { setIsPublic(!next) }
  }

  const addItem = async (stem) => {
    // Stop the preview if this track is the one playing.
    if (previewId === stem.id) { previewAudio.current?.pause(); setPreviewId(null) }
    // Default the track's cover to the source project's image (vinyl fallback is
    // handled on the public side when this is null).
    const cover = projList.find(p => p.id === pickProject)?.cover_url || null
    try {
      const r = await showcaseApi.addItem(stem.id, null, cover)
      const title = stem.suggested_name || stem.original_name || 'Untitled'
      setItems(list => [...list, { id: r.data.id, stem_id: stem.id, title, instrument: stem.instrument, caption: null, like_count: 0, play_count: 0, image_url: cover, allow_download: true, links: [] }])
      setPickFiles(list => list.filter(f => f.id !== stem.id))
    } catch (e) { flash(e.message || 'Could not add') }
  }

  const removeItem = async (id) => {
    setItems(list => list.filter(i => i.id !== id))
    try { await showcaseApi.removeItem(id) } catch { /* best-effort */ }
  }

  // Per-track edits stay LOCAL until the user hits Save — so changes feel
  // intentional (dirty → Saving… → Saved ✓) instead of silently dropping.
  const editItem = (id, patch) => setItems(list => list.map(i =>
    i.id === id ? { ...i, ...patch, _dirty: true, _saved: false } : i))

  // Multiple external links per track (Spotify / Apple Music / YouTube / …).
  const itemLinks   = (i) => Array.isArray(i.links) ? i.links : []
  const addLink     = (i) => editItem(i.id, { links: [...itemLinks(i), { label: 'Spotify', url: '' }] })
  const setLink     = (i, idx, patch) => editItem(i.id, { links: itemLinks(i).map((l, n) => n === idx ? { ...l, ...patch } : l) })
  const removeLink  = (i, idx) => editItem(i.id, { links: itemLinks(i).filter((_, n) => n !== idx) })

  const saveItem = async (id) => {
    const it = items.find(i => i.id === id)
    if (!it) return
    setItems(list => list.map(i => i.id === id ? { ...i, _saving: true } : i))
    try {
      await showcaseApi.updateItem(id, {
        caption: it.caption?.trim() || null,
        preview_only: !!it.preview_only,
        allow_download: it.allow_download !== false,
        links: itemLinks(it).filter(l => l.url?.trim()),
      })
      setItems(list => list.map(i => i.id === id ? { ...i, _saving: false, _dirty: false, _saved: true } : i))
      setTimeout(() => setItems(list => list.map(i => i.id === id ? { ...i, _saved: false } : i)), 2200)
    } catch (e) {
      setItems(list => list.map(i => i.id === id ? { ...i, _saving: false } : i))
      alert(e?.message || 'Could not save — try again')
    }
  }

  // Closing returns to your public page (not the app), if you have a handle.
  // Closing either editor screen returns to your public profile.
  const handleClose = () => {
    onClose?.()                         // let the host (Library overlay) tidy up
    navigate('/profile'); window.scrollTo(0, 0)
  }

  const liveHandle = profile?.handle
  const handleHint = {
    checking: <span style={{ color:C.t3 }}>checking…</span>,
    ok:       <span style={{ color:'#22c55e' }}>available ✓</span>,
    taken:    <span style={{ color:'#ef4444' }}>taken</span>,
    invalid:  <span style={{ color:'#ef4444' }}>3–30 chars: a–z, 0–9, _</span>,
  }[handleState]

  // ── styles ──
  const overlay = { position:'fixed', inset:0, zIndex:1000, background:C.bg, display:'flex', flexDirection:'column', overflowY:'auto' }
  const header  = { position:'sticky', top:0, zIndex:2, display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'16px 20px', background:C.bg, borderBottom:`1px solid ${C.border}` }
  const panel   = { width:'100%', maxWidth:1040, margin:'0 auto', padding:'clamp(16px,4vw,22px) clamp(14px,4vw,24px) 80px', boxSizing:'border-box' }
  const card    = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:'clamp(14px,4vw,20px)', marginBottom:14 }
  const cardTitle = { fontSize:11, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:16 }
  const label = { fontSize:12, fontWeight:700, color:C.t2, marginBottom:6, display:'block' }
  const input = { width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, background:C.bg, color:C.t1, fontSize:13.5, fontFamily:'inherit', boxSizing:'border-box' }

  return (
    <div style={overlay}>
      <input ref={avatarInput} type="file" accept="image/*" onChange={pickAvatar} style={{ display:'none' }} />
      <audio ref={previewAudio} onEnded={() => setPreviewId(null)} style={{ display:'none' }} />

      <div style={header}>
        <div style={{ fontSize:17, fontWeight:800, color:C.t1 }}>{mode === 'profile' ? 'Edit profile' : 'Your tracks'}</div>
        <button onClick={handleClose} title="Back to my profile" style={{ background:'none', border:'none', cursor:'pointer', color:C.t3, fontSize:22, lineHeight:1 }}>✕</button>
      </div>

      <style>{`
        .pe-grid { display:grid; grid-template-columns:1fr; gap:16px; align-items:start; max-width:820px; margin:0 auto; }
        .pe-col > div:last-child { margin-bottom:0; }
      `}</style>
      <div style={panel}>
        {loading ? <Loading pad="80px 0" /> : (
          <>
          <div className="pe-grid">
            {mode === 'profile' && (
            /* ── Left column: identity / visibility / about ── */
            <div className="pe-col">
            {/* ── Identity ── */}
            <div style={card}>
              <div style={{ display:'flex', gap:18, alignItems:'flex-start', flexWrap:'wrap' }}>
                {/* Photo (click to replace) */}
                <button onClick={() => avatarInput.current?.click()} title="Change photo"
                  style={{ position:'relative', border:'none', background:'none', padding:0, cursor:'pointer', borderRadius:'50%', flexShrink:0 }}>
                  <Avatar name={displayName || user?.full_name} url={avatar} size={84} />
                  <span style={{ position:'absolute', bottom:0, right:0, width:28, height:28, borderRadius:'50%', background:C.coral,
                    border:`2px solid ${C.surface}`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff' }}>
                    {uploadingAvatar
                      ? <span style={{ fontSize:11 }}>…</span>
                      : <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>}
                  </span>
                </button>

                <div style={{ flex:1, minWidth:200 }}>
                  <label style={label}>Display name</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} placeholder="Your producer name" style={{ ...input, marginBottom:14 }} />

                  <label style={label}>Handle {handleHint && <span style={{ marginLeft:8, fontWeight:500 }}>{handleHint}</span>}</label>
                  <div style={{ display:'flex', gap:8 }}>
                    <div style={{ position:'relative', flex:1 }}>
                      <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:C.t3, fontSize:13.5 }}>@</span>
                      <input value={handle} onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        placeholder="yourname" maxLength={30} style={{ ...input, paddingLeft:26 }} />
                    </div>
                    <button onClick={saveHandle} disabled={!handle || handleState === 'taken' || handleState === 'invalid' || handle === liveHandle}
                      style={{ ...primaryBtn, opacity: (!handle || handleState==='taken' || handleState==='invalid' || handle===liveHandle) ? .5 : 1 }}>Save</button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Visibility ── */}
            <div style={card}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:14 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:700, color:C.t1 }}>{isPublic ? 'Profile is public' : 'Profile is private'}</div>
                  <div style={{ fontSize:12, color:C.t3, marginTop:2 }}>
                    {liveHandle
                      ? <>dizko.ai/u/{liveHandle}{isPublic && <a href={`/u/${liveHandle}`} target="_blank" rel="noreferrer" style={{ color:C.coral, marginLeft:8, textDecoration:'none', fontWeight:600 }}>view ↗</a>}</>
                      : 'Claim a handle above to go public'}
                  </div>
                </div>
                <button onClick={togglePublic} aria-label="Toggle public" style={{ width:48, height:28, borderRadius:14, border:'none', cursor:'pointer', position:'relative', flexShrink:0,
                  background: isPublic ? C.coral : 'rgba(var(--fg),.18)', transition:'background .2s' }}>
                  <span style={{ position:'absolute', top:3, left: isPublic?23:3, width:22, height:22, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,.3)', transition:'left .2s cubic-bezier(.4,0,.2,1)' }} />
                </button>
              </div>
            </div>

            {/* ── About ── */}
            <div style={card}>
              <div style={cardTitle}>About</div>
              <div style={{ marginBottom:14 }}>
                <label style={label}>Bio</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={500} rows={3} placeholder="Tell people what you make…" style={{ ...input, resize:'vertical' }} />
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={label}>Links <span style={{ fontWeight:500, color:C.t3 }}>(one per line)</span></label>
                <textarea value={links} onChange={e => setLinks(e.target.value)} rows={2} placeholder="instagram.com/you&#10;soundcloud.com/you" style={{ ...input, resize:'vertical' }} />
              </div>
              <button onClick={() => saveProfile()} disabled={saving} style={{ ...primaryBtn, width:'100%', opacity:saving?.6:1 }}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </div>
            </div>
            )}

            {mode === 'tracks' && (
            <div className="pe-col">
            {/* ── Showcase ── */}
            <div style={card}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:4 }}>
                <div style={cardTitle}>Your showcase</div>
                <span style={{ fontSize:11, fontWeight:700, color:C.t3 }}>{items.length} {items.length === 1 ? 'track' : 'tracks'}</span>
              </div>
              <div style={{ fontSize:12, color:C.t3, marginBottom:16 }}>The tracks people see on your public page. Pick your best.</div>

              {items.length === 0 ? (
                <div style={{ textAlign:'center', padding:'26px 16px', borderRadius:12, border:`1px dashed ${C.border}`, marginBottom:18 }}>
                  <div style={{ width:46, height:46, borderRadius:14, margin:'0 auto 12px', display:'flex', alignItems:'center', justifyContent:'center', background:`${C.coral}14`, color:C.coral }}>
                    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                  </div>
                  <div style={{ fontSize:13.5, fontWeight:700, color:C.t1, marginBottom:4 }}>Add your first track</div>
                  <div style={{ fontSize:12, color:C.t3 }}>Choose a project below to pull tracks from your library.</div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
                  {items.map((i, idx) => (
                    <div key={i.id} style={{ padding:'10px 12px', borderRadius:12, background:C.bg, border:`1px solid ${C.border}` }}>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <span style={{ fontSize:11, fontWeight:800, color:C.t3, width:18, textAlign:'right', flexShrink:0 }}>{String(idx+1).padStart(2,'0')}</span>
                        <div style={{ width:36, height:36, borderRadius:9, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:`${C.coral}14`, color:C.coral }}>
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:C.t1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.title}</div>
                          <div style={{ fontSize:11, color:C.t3 }}>{[i.instrument, `${i.play_count||0} plays`, `${i.like_count||0} likes`].filter(Boolean).join(' · ')}</div>
                        </div>
                        <button onClick={() => removeItem(i.id)} title="Remove from profile"
                          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'5px 12px', cursor:'pointer', color:C.t2, fontSize:12, fontWeight:600, fontFamily:'inherit', flexShrink:0 }}>Remove</button>
                      </div>
                      <input value={i.caption || ''} onChange={e => editItem(i.id, { caption: e.target.value })}
                        maxLength={280} placeholder="Write a caption… (e.g. “made in 20 min, DM for the pack”)"
                        style={{ ...input, marginTop:10, fontSize:12.5, padding:'8px 11px' }} />
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap' }}>
                        <span style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.04em' }}>Public plays</span>
                        <div style={{ display:'inline-flex', padding:2, borderRadius:9, background:C.bg, border:`1px solid ${C.border}` }}>
                          {[['full','Full audio'],['preview','30s preview']].map(([val, lbl]) => {
                            const active = (val === 'preview') === !!i.preview_only
                            return (
                              <button key={val} onClick={() => editItem(i.id, { preview_only: val === 'preview' })}
                                style={{ border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:7,
                                  background: active ? C.grad : 'transparent', color: active ? '#fff' : C.t2 }}>{lbl}</button>
                            )
                          })}
                        </div>
                      </div>
                      {/* Allow downloads */}
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap' }}>
                        <span style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.04em' }}>Downloads</span>
                        <div style={{ display:'inline-flex', padding:2, borderRadius:9, background:C.bg, border:`1px solid ${C.border}` }}>
                          {[['on','Allow'],['off','Off']].map(([val, lbl]) => {
                            const active = (val === 'off') === (i.allow_download === false)
                            return (
                              <button key={val} onClick={() => editItem(i.id, { allow_download: val === 'on' })}
                                style={{ border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:7,
                                  background: active ? C.grad : 'transparent', color: active ? '#fff' : C.t2 }}>{lbl}</button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Multiple links — Spotify, Apple Music, YouTube … */}
                      <div style={{ marginTop:12 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.04em' }}>Links</span>
                        <div style={{ display:'flex', flexDirection:'column', gap:7, marginTop:7 }}>
                          {itemLinks(i).map((l, idx) => (
                            <div key={idx} style={{ display:'flex', gap:7, alignItems:'center' }}>
                              <select value={LINK_PRESETS.includes(l.label) ? l.label : 'Other'} onChange={e => setLink(i, idx, { label: e.target.value === 'Other' ? '' : e.target.value })}
                                style={{ ...input, width:128, flexShrink:0, fontSize:12, padding:'8px 9px', cursor:'pointer' }}>
                                {LINK_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                                <option value="Other">Other</option>
                              </select>
                              <input type="url" value={l.url || ''} onChange={e => setLink(i, idx, { url: e.target.value })}
                                maxLength={500} placeholder="https://…"
                                style={{ ...input, flex:1, fontSize:12.5, padding:'8px 11px' }} />
                              <button onClick={() => removeLink(i, idx)} aria-label="Remove link" title="Remove link"
                                style={{ flexShrink:0, width:30, height:30, borderRadius:8, border:`1px solid ${C.border}`, background:'none', color:C.t3, cursor:'pointer', fontSize:15, lineHeight:1 }}>×</button>
                            </div>
                          ))}
                          <button onClick={() => addLink(i)}
                            style={{ alignSelf:'flex-start', background:'none', border:`1px dashed ${C.border}`, borderRadius:8, padding:'7px 13px', cursor:'pointer', color:C.t2, fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                            + Add link
                          </button>
                        </div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:10, marginTop:10 }}>
                        {i._saved && <span style={{ fontSize:12, fontWeight:600, color:'#2bb673', display:'inline-flex', alignItems:'center', gap:5 }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Saved
                        </span>}
                        {i._dirty && !i._saved && <span style={{ fontSize:12, color:C.t3 }}>Unsaved changes</span>}
                        <button onClick={() => saveItem(i.id)} disabled={!i._dirty || i._saving}
                          style={{ border:'none', borderRadius:9, padding:'8px 20px', fontFamily:'inherit', fontSize:12.5, fontWeight:700,
                            cursor: (!i._dirty || i._saving) ? 'default' : 'pointer',
                            background: (!i._dirty || i._saving) ? 'rgba(var(--fg),.10)' : C.grad,
                            color: (!i._dirty || i._saving) ? C.t3 : '#fff', transition:'background .12s' }}>
                          {i._saving ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add a track */}
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:16 }}>
                <label style={label}>Add a track</label>

                {!pickProject ? (
                  <>
                    {/* Searchable project picker */}
                    <div style={{ position:'relative', marginBottom:10 }}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"
                        style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
                      <input value={projQuery} onChange={e => setProjQuery(e.target.value)} placeholder="Search your projects…" style={{ ...input, paddingLeft:34 }} />
                    </div>
                    {(() => {
                      const q = projQuery.trim().toLowerCase()
                      const filtered = q ? projList.filter(p => (p.title || '').toLowerCase().includes(q)) : projList
                      if (projList.length === 0) return <div style={{ fontSize:12.5, color:C.t3, padding:'8px 2px' }}>No projects yet.</div>
                      if (filtered.length === 0) return <div style={{ fontSize:12.5, color:C.t3, padding:'8px 2px' }}>No projects match “{projQuery}”.</div>
                      return (
                        <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:240, overflowY:'auto' }}>
                          {filtered.map(p => (
                            <button key={p.id} onClick={() => { setPickProject(p.id); setProjQuery('') }}
                              style={{ display:'flex', alignItems:'center', gap:11, width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:10,
                                background:C.bg, border:`1px solid ${C.border}`, cursor:'pointer', fontFamily:'inherit' }}
                              onMouseEnter={e => e.currentTarget.style.borderColor = C.coral}
                              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                              <div style={{ width:38, height:38, borderRadius:9, flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center',
                                background: p.cover_url ? `center/cover url(${p.cover_url})` : 'linear-gradient(145deg,#7E77D0,#2E2A66)' }}>
                                {!p.cover_url && <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={1.6} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:C.t1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.title || 'Untitled project'}</div>
                                <div style={{ fontSize:11, color:C.t3 }}>{p.type || 'Project'}</div>
                              </div>
                              <span style={{ color:C.t3, fontSize:16, flexShrink:0 }}>›</span>
                            </button>
                          ))}
                        </div>
                      )
                    })()}
                  </>
                ) : (
                  <>
                    {/* Selected project header + change */}
                    {(() => {
                      const sel = projList.find(p => p.id === pickProject)
                      return (
                        <div style={{ display:'flex', alignItems:'center', gap:11, padding:'8px 10px', borderRadius:10, background:C.bg, border:`1px solid ${C.border}`, marginBottom:12 }}>
                          <div style={{ width:34, height:34, borderRadius:8, flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center',
                            background: sel?.cover_url ? `center/cover url(${sel.cover_url})` : 'linear-gradient(145deg,#7E77D0,#2E2A66)' }}>
                            {!sel?.cover_url && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={1.6} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:10.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.06em' }}>From</div>
                            <div style={{ fontSize:13, fontWeight:600, color:C.t1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{sel?.title || 'Project'}</div>
                          </div>
                          <button onClick={() => setPickProject('')} style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'5px 12px', cursor:'pointer', color:C.t2, fontSize:12, fontWeight:600, fontFamily:'inherit' }}>Change</button>
                        </div>
                      )
                    })()}
                  </>
                )}
                {pickProject && (
                  loadingFiles ? <Loading label="Loading tracks…" pad="24px 0" /> :
                  pickFiles.length === 0 ? (
                    <div style={{ fontSize:12.5, color:C.t3, padding:'10px 2px' }}>Every track here is already on your profile. 🎉</div>
                  ) : (() => {
                    const fq = fileQuery.trim().toLowerCase()
                    const files = fq ? pickFiles.filter(f => (f.suggested_name || f.original_name || '').toLowerCase().includes(fq)) : pickFiles
                    return (
                    <>
                      <div style={{ position:'relative', marginBottom:8 }}>
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
                        <input value={fileQuery} onChange={e => setFileQuery(e.target.value)} placeholder="Search tracks…" style={{ ...input, paddingLeft:33, fontSize:12.5 }} />
                      </div>
                      {files.length === 0 ? <div style={{ fontSize:12.5, color:C.t3, padding:'8px 2px' }}>No tracks match “{fileQuery}”.</div> : (
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {files.map(f => {
                        const playing = previewId === f.id
                        return (
                        <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 12px', borderRadius:10, background:C.bg, border:`1px solid ${playing ? C.coral : C.border}` }}>
                          <button onClick={() => togglePreview(f)} aria-label={playing ? 'Pause' : 'Play'}
                            style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                              background: playing ? C.coral : `${C.coral}1a`, color: playing ? '#fff' : C.coral, fontSize:12 }}>
                            {playing ? '❚❚' : '▶'}
                          </button>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, color:C.t1, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{f.suggested_name || f.original_name || 'Untitled'}</div>
                            {f.instrument && <div style={{ fontSize:11, color:C.t3 }}>{f.instrument}</div>}
                          </div>
                          <button onClick={() => addItem(f)} style={{ ...primaryBtn, padding:'6px 16px', display:'inline-flex', alignItems:'center', gap:5 }}>
                            <span style={{ fontSize:15, lineHeight:1 }}>+</span> Add
                          </button>
                        </div>
                        )
                      })}
                    </div>
                      )}
                    </>
                    )
                  })()
                )}
              </div>
            </div>
            </div>
            )}
          </div>{/* /pe-grid */}

            {msg && (
              <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:3,
                padding:'10px 20px', borderRadius:100, background:C.t1, color:C.bg, fontSize:12.5, fontWeight:700, boxShadow:'0 8px 24px rgba(0,0,0,.25)' }}>{msg}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const primaryBtn = { border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:'pointer', background:C.grad, color:'#fff', fontFamily:'inherit', whiteSpace:'nowrap' }
