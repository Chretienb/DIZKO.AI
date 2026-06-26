import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, collaborators as collabsApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Spinner } from '../components/ui/index.jsx'
import { timeAgo } from '../lib/utils.js'
import astronautImg from '../assets/empty/astronaut-studio.jpg'
import ufoImg       from '../assets/empty/ufo-no-projects.jpg'

// ── Helpers ───────────────────────────────────────────────────────────────────
function pn(f) { try { return JSON.parse(f?.notes || '{}') } catch { return {} } }
function fmtDur(s) { if (!s) return '—'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` }
function hash(s = '') { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }

const DK = {
  panel:'var(--bg)', card:'var(--surface)', row:'var(--surface-2)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', t4:'var(--t4)',
  red:'#E95A51', green:'#3CDA6F',
  border:'1px solid var(--border-2)',
  font:'"Inter",-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif',
}

const ART = [
  ['#E95A51','#7A1F1A'], ['#7E77D0','#2E2A66'], ['#3CDA6F','#125A2C'],
  ['#EA9F1E','#7A4E06'], ['#E8709A','#7A1F46'], ['#4A8DD9','#163A66'],
  ['#5B5BD6','#26267A'], ['#D95A9C','#6E1E4A'],
]

const STEM_COLORS = {
  vocals:'#7E77D0', drums:'#E95A51', bass:'#3CDA6F', guitar:'#EA9F1E',
  keys:'#7E77D0', synth:'#7E77D0', harmony:'#E8709A', recording:'#E95A51',
  other:'var(--t3)', smart_bounce:'#3CDA6F',
}

const DEFAULT_COVER = '/default-cover.jpg'

// Cover art. Uses the project's uploaded cover when present; the big square
// (full) falls back to the default photo, small thumbs to a seeded gradient.
function Cover({ seed = '', size = 44, radius = 8, coverUrl = null }) {
  const [a, b] = ART[hash(seed) % ART.length]
  const full = size === 'full'
  const box = full ? { width:'100%', height:'100%', borderRadius:radius } : { width:size, height:size, borderRadius:radius }
  if (coverUrl) {
    return (
      <div style={{ ...box, flexShrink:0, position:'relative', overflow:'hidden',
        backgroundImage:`url(${coverUrl})`, backgroundSize:'cover', backgroundPosition:'center', backgroundColor:'#111' }}/>
    )
  }
  if (full) {
    return (
      <div style={{ ...box, flexShrink:0, position:'relative', overflow:'hidden',
        backgroundImage:`url(${DEFAULT_COVER})`, backgroundSize:'cover', backgroundPosition:'center', backgroundColor:'#111' }}/>
    )
  }
  return (
    <div style={{ ...box, flexShrink:0, position:'relative', overflow:'hidden',
      background:`linear-gradient(145deg,${a},${b})`, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <svg width={size*0.42} height={size*0.42} viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg),.7)" strokeWidth={1.6} strokeLinecap="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </div>
  )
}

function Heart({ on, onClick, size = 15, className = '' }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }} className={className}
      style={{ background:'none', border:'none', cursor:'pointer', padding:4, display:'flex', flexShrink:0 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? DK.red : 'none'} stroke={on ? DK.red : 'rgba(var(--fg),.35)'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
      </svg>
    </button>
  )
}

const TABS = [['upnext','Up Next'], ['stems','Stems'], ['people','People'], ['activity','Activity']]

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PageDashboard({ openModal, user, playTrack }) {
  const navigate = useNavigate()
  const isMobile = React.useContext(MobileCtx)

  const [projects,   setProjects] = useState([])
  const [loading,    setLoading]  = useState(true)
  const [selId,      setSelId]    = useState(null)
  const [files,      setFiles]    = useState([])
  const [collabs,    setCollabs]  = useState([])
  const [uploaders,  setUploaders]= useState({})
  const [tab,        setTab]      = useState('upnext')
  const [search,     setSearch]   = useState('')
  const [favs,       setFavs]     = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('dizko_favs') || '[]')) } catch { return new Set() } })

  const toggleFav = id => setFavs(prev => { const n = new Set(prev); n.has(id)?n.delete(id):n.add(id); localStorage.setItem('dizko_favs', JSON.stringify([...n])); return n })

  const resolveUploaders = (fl) => {
    const ids = [...new Set(fl.map(f => f.uploaded_by).filter(Boolean))]
    const token = localStorage.getItem('disco_token')
    ids.forEach(uid => fetch(`/api/users/${uid}`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.data) setUploaders(prev => ({ ...prev, [uid]: j.data.full_name || j.data.email?.split('@')[0] || 'Someone' })) })
      .catch(() => {}))
  }

  useEffect(() => {
    projectsApi.list().then(r => {
      const list = (r.data || []).filter(p => p.status !== 'Archived')   // archived projects stay out of the dashboard
      setProjects(list)
      if (list[0]) setSelId(list[0].id)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selId) return
    setFiles([]); setCollabs([])
    Promise.all([
      filesApi.list(selId).catch(() => ({ data:[] })),
      collabsApi.listByProject(selId).catch(() => ({ data:[] })),
    ]).then(([fRes, cRes]) => { const fl = fRes.data || []; setFiles(fl); setCollabs(cRes.data || []); resolveUploaders(fl) })
  }, [selId])

  // Derived
  const selProject  = projects.find(p => p.id === selId)
  const parentStems = files.filter(f => !pn(f).parent_stem_id && f.instrument !== 'smart_bounce')
  const latestMix   = files.find(f => f.instrument === 'smart_bounce')
  // Contributors = people you've ADDED, not yourself. The collaborators list
  // includes the owner as a synthetic 'owner' entry, so exclude that — a brand-new
  // solo project reads 0, and each person you invite adds 1.
  const contributors = collabs.filter(c => c.role !== 'owner').length

  const people = (() => {
    const m = new Map()
    collabs.forEach(c => { const nm = c.user?.full_name || c.user?.email?.split('@')[0] || 'Collaborator'; m.set(c.user_id || nm, { name:nm, role:c.role || 'Collaborator' }) })
    Object.entries(uploaders).forEach(([uid, nm]) => { if (!m.has(uid)) m.set(uid, { name:nm, role:'Contributor' }) })
    return [...m.values()]
  })()

  const activity = [...files].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,8).map(f => ({
    id:f.id, who:uploaders[f.uploaded_by]||'Someone', what:f.instrument||'a file', when:f.created_at,
    color:STEM_COLORS[f.instrument]||DK.red,
  }))

  const q = search.toLowerCase()
  const projList = projects.filter(p => !q || p.title.toLowerCase().includes(q))
  const stemList = parentStems.filter(f => !q || (f.suggested_name||f.original_name||'').toLowerCase().includes(q))

  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'50vh' }}><Spinner size={24}/></div>

  // ── Row renderers ──
  const projectRow = (p, i) => {
    const on = p.id === selId
    return (
      <div key={p.id} className="sp-row" onClick={() => { setSelId(p.id); setTab('upnext') }}
        style={{ display:'grid', gridTemplateColumns:'22px 46px 1fr auto 28px', alignItems:'center', gap:14, padding:'7px 12px', borderRadius:6, cursor:'pointer',
          background: on ? 'rgba(var(--fg),.07)' : 'transparent', transition:'background .1s' }}
        onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='rgba(var(--fg),.04)' }}
        onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent' }}>
        {/* number / play / eq */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
          {on ? (
            <div style={{ display:'flex', alignItems:'flex-end', gap:1.5, height:13 }}>
              {[0,1,2].map(k => <div key={k} style={{ width:2.5, borderRadius:2, background:DK.red, animation:`eqbar .8s ease-in-out ${k*0.15}s infinite` }}/>)}
            </div>
          ) : (<>
            <span className="sp-num" style={{ fontSize:13, color:DK.t4 }}>{i+1}</span>
            <svg className="sp-play" width={11} height={11} viewBox="0 0 24 24" fill={DK.t1}><polygon points="6,4 20,12 6,20"/></svg>
          </>)}
        </div>
        <Cover seed={p.id} size={46} radius={6} coverUrl={p.cover_url} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:500, color: on ? DK.red : DK.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</div>
          <div style={{ fontSize:12, color:DK.t3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.type || 'Single'}</div>
        </div>
        <span style={{ fontSize:11.5, color:DK.t3, justifySelf:'end' }}>{p.status || 'Draft'}</span>
        <Heart on={favs.has(p.id)} onClick={() => toggleFav(p.id)} className={`sp-heart ${favs.has(p.id) ? 'on' : ''}`} />
      </div>
    )
  }

  const stemRow = (f, i) => {
    const color = STEM_COLORS[f.instrument] || 'var(--t3)'
    const notes = pn(f)
    return (
      <div key={f.id} className="sp-row" onClick={() => playTrack(f)}
        style={{ display:'grid', gridTemplateColumns:'22px 46px 1fr auto 28px', alignItems:'center', gap:14, padding:'7px 12px', borderRadius:6, cursor:'pointer', transition:'background .1s' }}
        onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.04)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span className="sp-num" style={{ fontSize:13, color:DK.t4 }}>{i+1}</span>
          <svg className="sp-play" width={11} height={11} viewBox="0 0 24 24" fill={DK.t1}><polygon points="6,4 20,12 6,20"/></svg>
        </div>
        <Cover seed={f.id} size={46} radius={6} />
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:500, color:DK.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.suggested_name || f.original_name}</div>
          <div style={{ fontSize:12, color:DK.t3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{uploaders[f.uploaded_by] || 'Unknown'}</div>
        </div>
        <span style={{ fontSize:12, color:DK.t3, justifySelf:'end' }}>{fmtDur(notes.duration)}</span>
        <Heart on={favs.has(f.id)} onClick={() => toggleFav(f.id)} className={`sp-heart ${favs.has(f.id) ? 'on' : ''}`} />
      </div>
    )
  }

  const rightList = (
    <div style={{ flex:1, minHeight:0, overflowY:'auto', padding:'4px 8px 12px', display:'flex', flexDirection:'column', gap:2 }}>
      {tab === 'upnext' && (projList.length ? projList.map(projectRow)
        : (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'24px 24px 8px' }}>
            <img src={ufoImg} alt="" style={{ width:'100%', maxWidth:400, borderRadius:14, display:'block', marginBottom:20 }}/>
            <div style={{ fontSize:23, fontWeight:800, color:'#fff', letterSpacing:'-.6px', marginBottom:9 }}>No projects in sight</div>
            <div style={{ fontSize:13.5, color:DK.t3, lineHeight:1.6 }}>
              Looks like your up next list is empty.<br/>Create a project to see it here.
            </div>
          </div>
        ))}
      {tab === 'stems' && (stemList.length ? stemList.map(stemRow)
        : <div style={{ padding:'40px 16px', textAlign:'center', color:DK.t3, fontSize:13 }}>No stems in this project.</div>)}
      {tab === 'people' && (people.length ? people.map((p, i) => (
        <div key={i} className="sp-row"
          style={{ display:'grid', gridTemplateColumns:'22px 46px 1fr', alignItems:'center', gap:14, padding:'7px 12px', borderRadius:6, cursor:'pointer', transition:'background .1s' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.04)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span className="sp-num" style={{ fontSize:13, color:DK.t4 }}>{i+1}</span>
            <svg className="sp-play" width={11} height={11} viewBox="0 0 24 24" fill={DK.t1}><polygon points="6,4 20,12 6,20"/></svg>
          </div>
          <div style={{ width:46, height:46, borderRadius:'50%', background:`${ART[i%ART.length][0]}28`, color:ART[i%ART.length][0], display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:600, flexShrink:0 }}>{p.name[0]?.toUpperCase()}</div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:500, color:DK.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</div>
            <div style={{ fontSize:12, color:DK.t3 }}>{p.role}</div>
          </div>
        </div>
      )) : <div style={{ padding:'40px 16px', textAlign:'center', color:DK.t3, fontSize:13 }}>No people yet.</div>)}
      {tab === 'activity' && (activity.length ? activity.map((a, i) => (
        <div key={a.id} style={{ display:'flex', alignItems:'flex-start', gap:11, padding:'10px 12px', borderBottom: i < activity.length-1 ? DK.border : 'none' }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:a.color, flexShrink:0, marginTop:5 }}/>
          <div style={{ flex:1 }}>
            <p style={{ margin:'0 0 2px', fontSize:12.5, color:DK.t2, lineHeight:1.5 }}>
              <strong style={{ color:DK.t1 }}>{a.who}</strong> uploaded <span style={{ color:a.color }}>{a.what}</span>
            </p>
            <span style={{ fontSize:11, color:DK.t4 }}>{timeAgo(a.when)}</span>
          </div>
        </div>
      )) : <div style={{ padding:'40px 16px', textAlign:'center', color:DK.t3, fontSize:13 }}>No activity yet.</div>)}
    </div>
  )

  return (
    <div style={{ fontFamily:DK.font, margin:isMobile?'-16px':'-24px', padding:isMobile?'12px':'18px', minHeight:'100%' }}>
      <style>{`
        @keyframes eqbar { 0%,100%{height:4px} 50%{height:13px} }
        .sp-row .sp-play { display:none; }
        .sp-row:hover .sp-num { display:none; }
        .sp-row:hover .sp-play { display:inline-flex; }
        .sp-row .sp-heart { opacity:0; transition:opacity .12s; }
        .sp-row:hover .sp-heart, .sp-row .sp-heart.on { opacity:1; }
      `}</style>

      <h1 style={{ margin:'0 0 16px', fontSize: isMobile ? 22 : 26, fontWeight:700, color:DK.t1, letterSpacing:'-.7px' }}>Dashboard</h1>

      {/* ── WebPlayer panel ── */}
      <div style={{ background:DK.panel, borderRadius:20, border:DK.border, overflow:'hidden',
        display:'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 'calc(100vh - 90px)' }}>

        {/* ══ LEFT — Big square cover ══ */}
        <div style={{ flex: isMobile ? 'none' : '0 0 46%', padding: isMobile ? 14 : 20, display:'flex', flexDirection:'column', gap:14 }}>
          {/* Top actions */}
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => selProject && navigate(`/projects/${selProject.id}`)}
              style={{ display:'flex', alignItems:'center', gap:6, height:34, padding:'0 14px', borderRadius:9, border:DK.border, background:'rgba(var(--fg),.04)', color:DK.t2, fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:DK.font }}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.08)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(var(--fg),.04)'}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              Open Project
            </button>
            <button onClick={() => navigate('/studio')}
              style={{ display:'flex', alignItems:'center', gap:6, height:34, padding:'0 14px', borderRadius:9, border:DK.border, background:'rgba(var(--fg),.04)', color:DK.t2, fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:DK.font }}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.08)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(var(--fg),.04)'}>
              <svg width={13} height={13} viewBox="0 0 18 18" fill="currentColor"><rect x="6.5" y="1" width="5" height="9" rx="2.5"/><path d="M3.5 9.5a5.5 5.5 0 0 0 11 0" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/><line x1="9" y1="15" x2="9" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              Studio
            </button>
          </div>

          {/* Cover */}
          {selProject ? (
            <div style={{ position:'relative', flex: isMobile ? 'none' : 1, aspectRatio: isMobile ? '1 / 1' : 'auto', minHeight: isMobile ? 0 : 0, borderRadius:16, overflow:'hidden' }}>
              <Cover seed={selProject.id} size="full" radius={16} coverUrl={selProject.cover_url} />
              {/* Open project */}
              <button onClick={() => selProject && navigate(`/projects/${selProject.id}`)}
                aria-label="Open project"
                style={{ position:'absolute', top:16, right:16, width:48, height:48, borderRadius:'50%', border:'none', background:DK.red, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 6px 20px rgba(233,90,81,.5)' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
              </button>
              {/* Gradient overlay */}
              <div style={{ position:'absolute', left:0, right:0, bottom:0, padding:'40px 18px 18px',
                background:'linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.4) 55%, transparent 100%)',
                display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:12 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize: isMobile ? 24 : 30, fontWeight:900, color:'#fff', letterSpacing:'-1px', textTransform:'uppercase', lineHeight:1.05, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selProject.title}</div>
                  <div style={{ fontSize:13, color:'rgba(var(--fg),.7)', marginTop:2 }}>{selProject.type || 'Project'} · Updated {timeAgo(selProject.updated_at)}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#fff' }}>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="#fff"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                    {contributors === 0
                      ? <span style={{ color:'rgba(var(--fg),.6)' }}>Just you</span>
                      : <>{contributors} <span style={{ color:'rgba(var(--fg),.6)' }}>contributor{contributors !== 1 ? 's' : ''}</span></>}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#fff' }}>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
                    {parentStems.length} <span style={{ color:'rgba(var(--fg),.6)' }}>stems</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflowY:'auto' }}>
              {/* Astronaut hero */}
              <div style={{ flex:'1 1 auto', minHeight: isMobile ? 220 : 200, borderRadius:16, overflow:'hidden',
                background:`#000 center/cover no-repeat`, backgroundImage:`url(${astronautImg})` }}/>
              {/* Headline */}
              <div style={{ textAlign:'center', padding:'18px 6px 4px' }}>
                <div style={{ fontSize: isMobile ? 20 : 23, fontWeight:800, color:'#fff', letterSpacing:'-.6px', marginBottom:8 }}>
                  Your next hit starts here
                </div>
                <div style={{ fontSize:13.5, color:DK.t3, lineHeight:1.55, maxWidth:380, margin:'0 auto' }}>
                  Create your first project and bring your ideas to life. Collaborate, create, and make music like never before.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        {!isMobile && <div style={{ width:1, background:'rgba(var(--fg),.06)', flexShrink:0 }}/>}

        {/* ══ RIGHT — Up Next ══ */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0, padding: isMobile ? '0 0 14px' : '20px 0 0' }}>
          {/* Search row */}
          <div style={{ padding: isMobile ? '14px 14px 0' : '0 20px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, height:40, padding:'0 13px', borderRadius:10,
              background:'rgba(var(--fg),.04)', border:'1px solid transparent', transition:'border-color .15s, background .15s' }}
              onFocusCapture={e => { e.currentTarget.style.borderColor=`${DK.red}55`; e.currentTarget.style.background='rgba(var(--fg),.06)' }}
              onBlurCapture={e => { e.currentTarget.style.borderColor='transparent'; e.currentTarget.style.background='rgba(var(--fg),.04)' }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={DK.t3} strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search songs, albums, artists"
                style={{ flex:1, border:'none', outline:'none', background:'transparent', fontSize:13, color:DK.t1, fontFamily:DK.font }}/>
              {search && (
                <button onClick={() => setSearch('')} aria-label="Clear search"
                  style={{ border:'none', background:'none', cursor:'pointer', color:DK.t3, display:'flex', padding:2 }}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', gap:22, padding: isMobile ? '16px 16px 0' : '20px 22px 0', borderBottom:DK.border }}>
            {TABS.map(([id, label]) => {
              const on = tab === id
              return (
                <button key={id} onClick={() => setTab(id)}
                  style={{ background:'none', border:'none', cursor:'pointer', fontFamily:DK.font, fontSize:13.5, fontWeight: on ? 700 : 500,
                    color: on ? DK.t1 : DK.t3, padding:'0 0 12px', borderBottom:`2px solid ${on ? DK.t1 : 'transparent'}`, marginBottom:-1 }}>
                  {label}
                </button>
              )
            })}
          </div>

          {/* List */}
          {rightList}

          {/* New Project — themed CTA pinned to the bottom of the column */}
          <div style={{ marginTop:'auto', padding: isMobile ? '12px 14px 4px' : '14px 20px 4px' }}>
            <button onClick={() => openModal('new-project', {})} aria-label="Create a new project"
              style={{ width:'100%', height:52, display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                borderRadius:14, border:DK.border, background:'rgba(var(--fg),.05)', color:DK.t1,
                fontSize:14.5, fontWeight:800, cursor:'pointer', fontFamily:DK.font, transition:'background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--fg),.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--fg),.05)' }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={DK.red} strokeWidth={2.4} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Project
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
