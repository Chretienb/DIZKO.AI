import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, analytics as analyticsApi, files as filesApi, collaborators as collabsApi, venuesApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Avatar, Spinner, C } from '../components/ui/index.jsx'
import { getGreeting, firstName, todayLabel, timeAgo } from '../lib/utils.js'

function collabName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  const email = c?.user?.email || c?.email || ''
  if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  return 'Collaborator'
}

function collabColor(i) {
  return [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink][i % 6]
}

const CARD_GRADIENTS = [
  'linear-gradient(160deg,#F4937A,#c0394f 60%,#12060e)',
  'linear-gradient(160deg,#F7D98B,#d4793a 60%,#110900)',
  'linear-gradient(160deg,#E8709A,#8b1a4a 60%,#0e0010)',
  'linear-gradient(160deg,#F5C97A,#c06020 60%,#110700)',
  'linear-gradient(160deg,#a0e0f0,#2060b0 60%,#000820)',
  'linear-gradient(160deg,#c0a0f0,#6020c0 60%,#080010)',
]

function LoadingBlock({ size = 22 }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'36px 20px' }}>
      <Spinner size={size}/>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageDashboard({ playing, setPlay, drag, setDrag, openModal, user, playTrack }) {
  const navigate = useNavigate()
  const isMobile = React.useContext(MobileCtx)
  const [projects,       setProjects]   = useState([])
  const [overview,       setOverview]   = useState({ projects:null, files:null })
  const [loadingData,    setLoading]    = useState(true)
  const [projectFiles,   setFiles]      = useState([])
  const [projectCollabs, setCollabs]    = useState([])
  const [loadingDetail,  setLoadingDet] = useState(false)
  const [uploaderNames,  setUploaderNames] = useState({})
  const [listenerCities, setListenerCities] = useState([])
  const [cityVenues,     setCityVenues]     = useState({})
  const [selectedCity,   setSelectedCity]   = useState(null)
  const [loadingVenues,  setLoadingVenues]  = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data:[] })),
      analyticsApi.overview().catch(() => ({ data:{} })),
    ]).then(([projRes, overRes]) => {
      setProjects(projRes.data || [])
      setOverview(overRes.data || {})
    }).finally(() => setLoading(false))
  }, [])

  const firstProjectId = projects[0]?.id

  const resolveUploaders = (files) => {
    const ids = [...new Set(files.map(f => f.uploaded_by).filter(Boolean))]
    const token = localStorage.getItem('disco_token')
    ids.forEach(uid => {
      fetch(`/api/users/${uid}`, { headers:{ Authorization:`Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (!j?.data) return
          const u = j.data
          setUploaderNames(prev => ({ ...prev, [uid]: u.full_name || u.email?.split('@')[0] || 'Someone' }))
        })
        .catch(e => console.warn('[dashboard]', e?.message))
    })
  }

  useEffect(() => {
    if (!firstProjectId) return
    setLoadingDet(true)
    Promise.all([
      filesApi.list(firstProjectId).catch(() => ({ data:[] })),
      collabsApi.listByProject(firstProjectId).catch(() => ({ data:[] })),
    ]).then(([fRes, cRes]) => {
      const files = fRes.data || []
      setFiles(files)
      setCollabs(cRes.data || [])
      resolveUploaders(files)
    }).finally(() => setLoadingDet(false))
  }, [firstProjectId])

  useEffect(() => {
    if (!firstProjectId) return
    const channel = supabase.channel(`dashboard:${firstProjectId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'stems' }, payload => {
        const s = payload.new
        setFiles(prev => {
          if (prev.find(f => f.id === s.id)) return prev
          resolveUploaders([s])
          return [s, ...prev]
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [firstProjectId])

  useEffect(() => {
    venuesApi.cities().then(res => {
      const cities = res.data || []
      setListenerCities(cities)
      if (cities.length > 0) {
        const top = cities[0]
        setSelectedCity(top.city)
        setLoadingVenues(true)
        venuesApi.search(top.city, top.region)
          .then(r => setCityVenues(prev => ({ ...prev, [top.city]: r.data || [] })))
          .catch(e => console.warn('[venues]', e?.message))
          .finally(() => setLoadingVenues(false))
      }
    }).catch(e => console.warn('[venues]', e?.message))
  }, [projects.length])

  const loadVenuesForCity = (city, region = '') => {
    setSelectedCity(city)
    if (cityVenues[city]) return
    setLoadingVenues(true)
    venuesApi.search(city, region)
      .then(r => setCityVenues(prev => ({ ...prev, [city]: r.data || [] })))
      .catch(e => console.warn('[venues]', e?.message))
      .finally(() => setLoadingVenues(false))
  }

  const projectCount = overview.projects ?? projects.length
  const fileCount    = overview.files    ?? '—'
  const latestMix    = projectFiles.find(f => f.instrument === 'smart_bounce')
  const pn = f => { try { return JSON.parse(f.notes||'{}') } catch { return {} } }

  const mixContributors = latestMix
    ? [...new Set(projectFiles.filter(f => f.instrument !== 'original' && f.instrument !== 'smart_bounce' && !pn(f).parent_stem_id).map(f => f.uploaded_by))].slice(0, 5)
    : []

  const statCards = [
    { label:'Active Projects', val:loadingData?null:String(projectCount), sub:`${projects.length} total`, accent:C.coral, page:'projects',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> },
    { label:'Total Files', val:loadingData?null:String(fileCount), sub:'in your projects', accent:C.amber, page:'library',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13,2 13,9 20,9"/></svg> },
    { label:'Collaborators', val:loadingData?null:String(overview.collaborators??0), sub:'across projects', accent:C.pink, page:'collaborators',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
  ]

  const STEM_COLORS = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber, guitar:'#f59e0b', keys:'#6366f1', harmony:'#ec4899', recording:C.coral, demo:'#64748b' }

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <p style={{ margin:'0 0 4px', fontSize:11, fontWeight:700, color:C.t3, letterSpacing:'.1em', textTransform:'uppercase' }}>{todayLabel()}</p>
          <h1 style={{ margin:0, fontSize:28, fontWeight:900, color:C.t1, letterSpacing:'-1px' }}>{getGreeting()}, {firstName(user?.full_name)}.</h1>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)', gap:12, marginBottom:24 }}>
        {statCards.map(s => (
          isMobile ? (
            <div key={s.label}
              style={{ borderRadius:16, padding:'20px 18px', background:C.surface, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:12 }}>{s.label}</div>
              <div style={{ fontSize:36, fontWeight:900, color:C.t1, letterSpacing:'-2px', lineHeight:1, marginBottom:6 }}>
                {s.val===null?<Spinner size={22} color={s.accent}/>:s.val}
              </div>
              <div style={{ fontSize:11.5, color:s.accent, fontWeight:600 }}>{s.sub}</div>
            </div>
          ) : (
            <button key={s.label} onClick={()=>navigate(`/${s.page}`)} aria-label={`${s.label}: ${s.val??'loading'}`}
              style={{ borderRadius:16, padding:'20px 18px', cursor:'pointer', background:C.surface,
                border:`1px solid ${C.border}`, transition:'all .18s', textAlign:'left', width:'100%' }}
              onMouseEnter={e=>{e.currentTarget.style.background=C.surface2;e.currentTarget.style.borderColor='rgba(255,255,255,.12)'}}
              onMouseLeave={e=>{e.currentTarget.style.background=C.surface;e.currentTarget.style.borderColor=C.border}}>
              <div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:12 }}>{s.label}</div>
              <div style={{ fontSize:36, fontWeight:900, color:C.t1, letterSpacing:'-2px', lineHeight:1, marginBottom:6 }}>
                {s.val===null?<Spinner size={22} color={s.accent}/>:s.val}
              </div>
              <div style={{ fontSize:11.5, color:s.accent, fontWeight:600 }}>{s.sub}</div>
            </button>
          )
        ))}
      </div>

      {/* AI Session Mix */}
      {projects.length>0 && (
        <div style={{ borderRadius:20, background:'linear-gradient(135deg,#111118 0%,#1a0a1e 50%,#0a1a1e 100%)', padding:'28px 32px', marginBottom:24, position:'relative', overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,.2)' }}>
          <div style={{ position:'absolute', top:-60, right:-60, width:200, height:200, borderRadius:'50%', background:`${C.coral}20`, filter:'blur(60px)', pointerEvents:'none' }}/>
          <div style={{ position:'absolute', bottom:-40, left:100, width:160, height:160, borderRadius:'50%', background:'rgba(139,92,246,.15)', filter:'blur(50px)', pointerEvents:'none' }}/>
          <div style={{ position:'relative', display:'flex', alignItems:'center', gap:28 }}>
            <div style={{ flexShrink:0 }}>
              {latestMix ? (
                <button onClick={()=>playTrack(latestMix)} style={{ width:64, height:64, borderRadius:20, border:'none', cursor:'pointer', background:`linear-gradient(135deg,${C.coral},#a855f7)`, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 8px 24px ${C.coral}50, 0 4px 12px rgba(0,0,0,.3)`, transition:'transform .15s' }}
                  onMouseEnter={e=>e.currentTarget.style.transform='scale(1.06)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:3 }}><polygon points="5,3 19,12 5,21"/></svg>
                </button>
              ) : (
                <div style={{ width:64, height:64, borderRadius:20, background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth={1.5} strokeLinecap="round"><path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/></svg>
                </div>
              )}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <div aria-hidden="true" style={{ width:7, height:7, borderRadius:'50%', background:latestMix?'#22c55e':'rgba(255,255,255,.2)', boxShadow:latestMix?'0 0 8px #22c55e':'none' }}/>
                <span style={{ fontSize:10.5, fontWeight:700, color:'rgba(255,255,255,.4)', textTransform:'uppercase', letterSpacing:'.1em' }}>
                  {latestMix?'AI Session Mix · Ready':'AI Session Mix · Waiting for takes'}
                </span>
              </div>
              <div style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.6px', marginBottom:6 }}>{projects[0]?.title||'Session'}</div>
              <div style={{ fontSize:13, color:'rgba(255,255,255,.4)', marginBottom:12 }}>
                {latestMix?`Updated ${timeAgo(latestMix.created_at)} · All contributor parts mixed automatically`:'Upload tracks to start the collaborative session. AI mixes automatically.'}
              </div>
              {mixContributors.length>0 && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ display:'flex' }}>
                    {mixContributors.map((uid,i)=>(
                      <div key={uid} style={{ marginLeft:i===0?0:-8, zIndex:mixContributors.length-i }}>
                        <Avatar name={uploaderNames[uid]||'?'} url={null} size={28} color={C.coral} border="2px solid rgba(17,17,24,1)" style={{ borderRadius:'50%' }}/>
                      </div>
                    ))}
                  </div>
                  <span style={{ fontSize:12, color:'rgba(255,255,255,.4)', marginLeft:4 }}>{mixContributors.length} contributor{mixContributors.length!==1?'s':''} · auto-mixed</span>
                </div>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
              {latestMix && (
                <a href={latestMix.file_url} download="session_mix.wav" style={{ height:36, padding:'0 16px', borderRadius:10, border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.07)', color:'rgba(255,255,255,.7)', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:7, textDecoration:'none', transition:'background .12s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.12)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.07)'}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </a>
              )}
              <button onClick={()=>navigate('/studio')} style={{ height:36, padding:'0 16px', borderRadius:10, border:'none', background:latestMix?`linear-gradient(135deg,${C.coral},#a855f7)`:'rgba(255,255,255,.08)', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', boxShadow:latestMix?`0 4px 14px ${C.coral}40`:'none' }}>
                {latestMix?'Open Studio →':'Go to Studio →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Projects grid */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <h2 style={{ margin:0, fontSize:15, fontWeight:800, color:C.t1, letterSpacing:'-.4px' }}>Your Projects</h2>
          <button onClick={()=>navigate('/projects')} style={{ background:'none', border:'none', fontSize:12.5, fontWeight:600, color:C.coral, cursor:'pointer' }}>See all →</button>
        </div>
        {loadingData ? (
          <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)', gap:12 }}>
            {[0,1,2,3].map(i=><div key={i} style={{ borderRadius:20, height:isMobile?220:280, background:'linear-gradient(160deg,#e8e8e8,#d0d0d0)' }}/>)}
          </div>
        ) : projects.length===0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'48px 24px', borderRadius:20, background:C.surface, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:12 }}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            <div style={{ fontSize:14, fontWeight:700, color:C.t1, marginBottom:6 }}>No projects yet</div>
            <div style={{ fontSize:12.5, color:C.t3, marginBottom:16 }}>Create your first project to get started</div>
            <button onClick={()=>openModal('new-project',{})} style={{ background:C.grad, border:'none', borderRadius:10, padding:'9px 20px', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>+ New Project</button>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)', gap:16 }}>
            {projects.slice(0,4).map((p,i)=>{
              const g=CARD_GRADIENTS[i%CARD_GRADIENTS.length], isOwner=p.owner_id===user?.id
              return (
                <div key={p.id??i} role="button" tabIndex={0} aria-label={`Open project ${p.title}`}
                  onClick={()=>navigate(`/projects/${p.id}`)}
                  onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();navigate(`/projects/${p.id}`)} }}
                  style={{ borderRadius:20, overflow:'hidden', cursor:'pointer', position:'relative', height:isMobile?220:280, display:'flex', flexDirection:'column', boxShadow:'0 6px 24px rgba(0,0,0,.16)', transition:'transform .22s, box-shadow .22s' }}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-6px)';e.currentTarget.style.boxShadow='0 20px 48px rgba(0,0,0,.24)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.16)'}}>
                  <div style={{ flex:1, background:g, position:'relative', overflow:'hidden' }}>
                    <div style={{ position:'absolute', top:-30, right:-30, width:130, height:130, borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.1)' }}/>
                    <div style={{ position:'absolute', bottom:16, right:16, opacity:.15 }}><svg width={36} height={36} viewBox="0 0 24 24" fill="white"><path d="M9 18V5l12-3v13M6 21a3 3 0 100-6 3 3 0 000 6zM18 18a3 3 0 100-6 3 3 0 000 6z"/></svg></div>
                    <div style={{ position:'absolute', top:12, left:12, zIndex:2, padding:'4px 10px', borderRadius:100, fontSize:10, fontWeight:700, backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', background:isOwner?'rgba(244,147,122,.7)':'rgba(255,255,255,.16)', color:'#fff', border:`1px solid ${isOwner?'rgba(244,147,122,.4)':'rgba(255,255,255,.2)'}` }}>{isOwner?'★ Creator':'Invited'}</div>
                  </div>
                  <div style={{ background:C.surface, padding:'14px 16px 16px', flexShrink:0 }}>
                    {p.type&&<div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:4 }}>{p.type}</div>}
                    <div style={{ fontSize:15, fontWeight:900, color:C.t1, letterSpacing:'-.4px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:10 }}>{p.title}</div>
                    <button onClick={e=>{e.stopPropagation();navigate(`/projects/${p.id}`)}} style={{ width:'100%', padding:'8px', borderRadius:100, border:'none', background:g, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', boxShadow:'0 3px 10px rgba(0,0,0,.18)', transition:'opacity .15s' }}
                      onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>Open →</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Venue recommendations */}
      {listenerCities.length>0 && (
        <div style={{ background:C.surface, borderRadius:20, marginBottom:20, padding:'24px 24px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:`1px solid ${C.border}` }}>

          {/* Header row */}
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:18 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2.2} strokeLinecap="round">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <span style={{ fontSize:11, fontWeight:700, color:C.coral, letterSpacing:'.04em' }}>You are based in this area</span>
              </div>
              <div style={{ fontSize:20, fontWeight:800, color:'#0f0f0f', letterSpacing:'-0.5px', lineHeight:1.15 }}>
                Potential venues in{' '}
                <span style={{ color:'#0f0f0f' }}>{listenerCities.slice(0,2).map(c=>c.city).join(' & ')}</span>
              </div>
              <div style={{ fontSize:12, color:C.t3, marginTop:4, fontWeight:500 }}>Based on where you are located</div>
            </div>
            {listenerCities.length > 1 && (
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {listenerCities.slice(0,4).map(c=>(
                  <button key={c.city} onClick={()=>loadVenuesForCity(c.city,c.region)}
                    style={{ padding:'5px 14px', borderRadius:100, fontSize:12, fontWeight:700, cursor:'pointer', transition:'all .15s',
                      background: selectedCity===c.city ? '#0f0f0f' : 'transparent',
                      border: `1.5px solid ${selectedCity===c.city ? '#0f0f0f' : 'rgba(0,0,0,.15)'}`,
                      color: selectedCity===c.city ? '#fff' : '#555' }}>
                    {c.city}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Venue list */}
          {loadingVenues ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:10 }}>
              {[0,1,2,3].map(i=><div key={i} style={{ height:82, borderRadius:12, background:'#f4f4f4' }}/>)}
            </div>
          ) : (cityVenues[selectedCity]||[]).length===0 ? (
            <div style={{ textAlign:'center', padding:'24px 0', fontSize:13, color:'#ccc' }}>No venues found in {selectedCity}</div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:10 }}>
              {(cityVenues[selectedCity]||[]).map(v=>(
                <a key={v.id} href={v.url||'#'} target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration:'none', padding:'13px 15px', borderRadius:12, background:C.surface2, border:'1.5px solid #f0f0f0', transition:'all .15s', display:'flex', flexDirection:'column', gap:5 }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='#0f0f0f';e.currentTarget.style.background='#fff'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='#f0f0f0';e.currentTarget.style.background='#fafafa'}}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#0f0f0f', lineHeight:1.35,
                    overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box',
                    WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{v.name}</div>
                  <div style={{ fontSize:11, color:C.t3, fontWeight:500 }}>{v.address || `${v.city}, ${v.state}`}</div>
                  {v.url && (
                    <div style={{ fontSize:11, color:C.coral, fontWeight:700, display:'flex', alignItems:'center', gap:3, marginTop:1 }}>
                      Book venue
                      <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom grid */}
      {projects.length>0 && (
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1.4fr 1fr', gap:16 }}>
          {/* Files card */}
          <div style={{ background:C.surface, borderRadius:20, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:`1px solid ${C.border}` }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 22px 14px' }}>
              <div>
                <div style={{ fontSize:16, fontWeight:900, color:C.t1, letterSpacing:'-.4px' }}>{projects[0]?.title||'Project Files'}</div>
                <div style={{ fontSize:12, color:C.t3, marginTop:3 }}>
                  {(() => {
                    const takeCount = projectFiles.filter(f => f.instrument && f.instrument!=='original' && f.instrument!=='smart_bounce' && !pn(f).parent_stem_id).length
                    const analyzing = projectFiles.filter(f => pn(f).status==='analyzing').length
                    if (takeCount===0 && analyzing>0) return <><Spinner size={10} color={C.coral}/> AI analyzing…</>
                    return <>{takeCount} take{takeCount!==1?'s':''} · {projects[0]?.status||'Draft'}{analyzing>0?` · ${analyzing} analyzing`:''}</>
                  })()}
                </div>
              </div>
              <button onClick={()=>openModal('upload',{project:projects[0]})} style={{ padding:'8px 16px', borderRadius:10, background:C.grad, border:'none', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow:`0 3px 10px ${C.coral}30` }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round"><polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                Upload
              </button>
            </div>
            {loadingDetail ? <LoadingBlock/> : projectFiles.length===0 ? (
              <div style={{ padding:'32px', textAlign:'center', color:C.t3, fontSize:12.5 }}>No files yet — upload your first take.</div>
            ) : (
              <div>
                {projectFiles.filter(f=>f.instrument==='original').map(f=>{
                  const notes=pn(f)
                  if (!(notes.status==='processing'||notes.pipeline==='local')) return null
                  return (
                    <div key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 20px', borderBottom:'1px solid rgba(0,0,0,.04)', background:'rgba(245,158,11,.03)' }}>
                      <Spinner size={14} color={C.amber}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.original_name}</div>
                        <div style={{ fontSize:10.5, color:C.amber, marginTop:2, fontWeight:600 }}>Dizko.ai analyzing audio…</div>
                      </div>
                    </div>
                  )
                })}
                {['vocals','drums','bass','other','guitar','keys','harmony','recording','demo'].map(type=>{
                  const stemColor = STEM_COLORS[type]||C.coral
                  const group = projectFiles.filter(f=>f.instrument===type&&!pn(f).parent_stem_id)
                  if (!group.length) return null
                  return (
                    <div key={type}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 20px 4px', borderTop:'1px solid rgba(0,0,0,.04)' }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', background:stemColor, flexShrink:0 }}/>
                        <span style={{ fontSize:10, fontWeight:800, color:stemColor, textTransform:'uppercase', letterSpacing:'.1em' }}>{type}</span>
                        <span style={{ fontSize:10, color:'#ddd', fontWeight:500 }}>{group.length}</span>
                      </div>
                      {group.slice(0,2).map(f=>{
                        const notes=pn(f)
                        return (
                          <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 20px', cursor:'pointer', transition:'background .1s' }}
                            onClick={()=>playTrack(f)} onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.025)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                            <button style={{ width:28, height:28, borderRadius:'50%', flexShrink:0, background:`${stemColor}18`, border:`1px solid ${stemColor}33`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                              <svg width={8} height={8} viewBox="0 0 24 24" fill={stemColor} style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                            </button>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:12.5, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.suggested_name||f.original_name}</div>
                            </div>
                            <div style={{ display:'flex', gap:5, flexShrink:0, alignItems:'center' }}>
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:6, background:`${stemColor}15`, color:stemColor, textTransform:'capitalize', border:`1px solid ${stemColor}25` }}>{f.instrument}</span>
                              {notes.bpm&&<span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:6, background:`${stemColor}12`, color:stemColor }}>{Math.round(notes.bpm)} BPM</span>}
                              {notes.key&&<span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:6, background:'rgba(0,0,0,.05)', color:C.t3 }}>{notes.key}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ margin:'8px 14px 14px' }}>
              <div onClick={()=>openModal('upload',{project:projects[0]})}
                style={{ borderRadius:12, border:'1.5px dashed rgba(0,0,0,.09)', padding:'12px 16px', display:'flex', alignItems:'center', gap:10, cursor:'pointer', transition:'all .15s' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.coral;e.currentTarget.style.background=`${C.coral}05`}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,0,0,.09)';e.currentTarget.style.background='transparent'}}
                onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false)}}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round"><polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                <span style={{ fontSize:12, color:C.t3, fontWeight:500 }}>Drop to upload · WAV · MP3 · AIFF</span>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {/* Recent Activity */}
            <div style={{ background:C.surface, borderRadius:20, overflow:'hidden', flex:1, boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:`1px solid ${C.border}` }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 20px 12px' }}>
                <div style={{ fontSize:14, fontWeight:900, color:C.t1, letterSpacing:'-.3px' }}>Recent Activity</div>
                <button onClick={()=>navigate('/analytics')} style={{ fontSize:12, color:C.t3, fontWeight:600, background:'none', border:'none', cursor:'pointer' }}>See all →</button>
              </div>
              {loadingDetail ? <div style={{ padding:'12px 18px' }}><Spinner size={16}/></div>
              : projectFiles.length===0 ? <div style={{ padding:'12px 18px 16px', fontSize:12, color:C.t3 }}>No activity yet.</div>
              : (() => {
                const events=[], seenParent=new Set()
                const sorted=[...projectFiles].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
                for (const f of sorted) {
                  const n=pn(f)
                  if (n.parent_stem_id) {
                    if (!seenParent.has(n.parent_stem_id)) {
                      seenParent.add(n.parent_stem_id)
                      const siblings=projectFiles.filter(x=>pn(x).parent_stem_id===n.parent_stem_id)
                      events.push({type:'separation',id:`sep_${n.parent_stem_id}`,f,count:siblings.length,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Someone'})
                    }
                  } else if (f.instrument==='smart_bounce') {
                    events.push({type:'bounce',id:f.id,f,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Dizko.ai'})
                  } else if (f.instrument&&f.instrument!=='original') {
                    events.push({type:'upload',id:f.id,f,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Someone'})
                  } else if (f.instrument==='original') {
                    events.push({type:'upload',id:f.id,f,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Someone'})
                  }
                  if (events.length>=6) break
                }
                const dotColor=ev=>ev.type==='bounce'?'#22c55e':ev.type==='separation'?C.amber:(STEM_COLORS[ev.f.instrument]||C.coral)
                return events.slice(0,5).map((ev,i)=>(
                  <div key={ev.id} style={{ display:'flex', alignItems:'flex-start', gap:11, padding:'8px 18px', borderBottom:i<Math.min(4,events.length-1)?'1px solid rgba(0,0,0,.04)':'none' }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:dotColor(ev), marginTop:5, flexShrink:0, boxShadow:ev.type==='bounce'?`0 0 6px ${dotColor(ev)}`:'none' }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, color:C.t2, lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        <strong style={{ fontWeight:700, color:C.t1 }}>{ev.who}</strong>
                        {ev.type==='upload'&&<> uploaded <span style={{ color:dotColor(ev), fontWeight:600 }}>{ev.f.instrument==='original'?ev.f.original_name:ev.f.instrument||'a file'}</span></>}
                        {ev.type==='separation'&&<> separated <span style={{ color:C.amber, fontWeight:600 }}>{ev.count} stems</span></>}
                        {ev.type==='bounce'&&<> updated the <span style={{ color:'#22c55e', fontWeight:600 }}>session mix</span></>}
                      </div>
                      <div style={{ fontSize:10.5, color:'#ccc', marginTop:2 }}>{timeAgo(ev.created_at)}</div>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
