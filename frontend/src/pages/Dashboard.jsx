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

  const heroGradient = CARD_GRADIENTS[0]

  return (
    <>
      {/* ── HERO BANNER — like the artist card in reference ─────────────────── */}
      <div style={{ borderRadius:20, overflow:'hidden', marginBottom:20, position:'relative',
        height: isMobile ? 180 : 220,
        background: projects.length ? CARD_GRADIENTS[0] : 'linear-gradient(135deg,#1a1a1f,#222228)',
        boxShadow:'0 8px 32px rgba(0,0,0,.5)' }}>

        {/* Ambient blobs */}
        <div style={{ position:'absolute', top:-40, right:-40, width:200, height:200,
          borderRadius:'50%', background:'rgba(255,255,255,.08)', filter:'blur(60px)', pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:-20, left:60, width:160, height:160,
          borderRadius:'50%', background:'rgba(0,0,0,.3)', filter:'blur(40px)', pointerEvents:'none' }}/>

        <div style={{ position:'relative', height:'100%', display:'flex', flexDirection:'column',
          justifyContent:'flex-end', padding: isMobile ? '20px' : '28px 32px' }}>

          {/* Badge */}
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
            <div style={{ width:7, height:7, borderRadius:'50%',
              background: latestMix ? '#22c55e' : 'rgba(255,255,255,.4)',
              boxShadow: latestMix ? '0 0 8px #22c55e' : 'none' }}/>
            <span style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,.7)',
              textTransform:'uppercase', letterSpacing:'.1em' }}>
              {latestMix ? 'AI Session Mix · Ready' : 'Your Workspace'}
            </span>
          </div>

          {/* Project name */}
          <h1 style={{ margin:'0 0 6px', fontSize: isMobile ? 26 : 36, fontWeight:900,
            color:'#fff', letterSpacing:'-1.5px', lineHeight:1.1 }}>
            {projects.length ? (projects[0]?.title || 'My Session') : `${getGreeting()}, ${firstName(user?.full_name)}.`}
          </h1>

          {/* Meta */}
          <p style={{ margin:'0 0 18px', fontSize:13, color:'rgba(255,255,255,.55)', fontWeight:500 }}>
            {latestMix
              ? `Updated ${timeAgo(latestMix.created_at)} · All contributor parts mixed automatically`
              : projects.length
                ? `${projectFiles.filter(f=>f.instrument&&f.instrument!=='original'&&f.instrument!=='smart_bounce').length} stems · ${projects.length} project${projects.length!==1?'s':''}`
                : todayLabel()}
          </p>

          {/* Actions */}
          <div style={{ display:'flex', gap:10 }}>
            {latestMix && (
              <button onClick={()=>playTrack(latestMix)}
                style={{ height:40, padding:'0 22px', borderRadius:100, border:'none',
                  background:'#111', color:'#fff', fontSize:13, fontWeight:800,
                  cursor:'pointer', display:'flex', alignItems:'center', gap:8,
                  boxShadow:'0 4px 16px rgba(0,0,0,.4)', transition:'opacity .12s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
                onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                Play Mix
              </button>
            )}
            <button onClick={()=>navigate('/studio')}
              style={{ height:40, padding:'0 20px', borderRadius:100,
                border:'1.5px solid rgba(255,255,255,.35)', background:'transparent',
                color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer',
                display:'flex', alignItems:'center', gap:6, transition:'background .12s' }}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.12)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {latestMix ? 'Open Studio →' : 'Go to Studio →'}
            </button>
            {projects.length > 0 && (
              <button onClick={()=>openModal('upload',{project:projects[0]})}
                style={{ height:40, padding:'0 20px', borderRadius:100,
                  border:'1.5px solid rgba(255,255,255,.35)', background:'transparent',
                  color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', transition:'background .12s' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.12)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                + Upload
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 2-COLUMN LAYOUT ────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap:16, alignItems:'start' }}>

      {/* LEFT — Projects + Files */}
      <div>

      {/* Projects row — horizontal like "Popular Releases" */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <h2 style={{ margin:0, fontSize:15, fontWeight:800, color:'rgba(255,255,255,.9)', letterSpacing:'-.3px' }}>Your Projects</h2>
          <button onClick={()=>navigate('/projects')} style={{ background:'none', border:'none', fontSize:12.5, fontWeight:600, color:C.coral, cursor:'pointer' }}>See all →</button>
        </div>
        {loadingData ? (
          <div style={{ display:'flex', gap:12, overflowX:'auto', paddingBottom:4 }}>
            {[0,1,2,3].map(i=><div key={i} style={{ borderRadius:16, minWidth:160, height:140, background:'rgba(255,255,255,.05)', flexShrink:0 }}/>)}
          </div>
        ) : projects.length===0 ? (
          <div style={{ padding:'32px 20px', borderRadius:16, background:'rgba(255,255,255,.04)',
            border:'1px dashed rgba(255,255,255,.1)', textAlign:'center' }}>
            <div style={{ fontSize:13, color:'rgba(255,255,255,.3)', marginBottom:14 }}>No projects yet</div>
            <button onClick={()=>openModal('new-project',{})}
              style={{ background:C.grad, border:'none', borderRadius:100, padding:'8px 20px', color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
              + New Project
            </button>
          </div>
        ) : (
          <div style={{ display:'flex', gap:12, overflowX:'auto', paddingBottom:4 }}>
            {projects.slice(0,6).map((p,i)=>{
              const g = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
              const isOwner = p.owner_id===user?.id
              return (
                <div key={p.id??i}
                  onClick={()=>navigate(`/projects/${p.id}`)}
                  style={{
                    minWidth:170, width:170, flexShrink:0, borderRadius:16,
                    overflow:'hidden', cursor:'pointer', display:'flex', flexDirection:'column',
                    boxShadow:'0 6px 24px rgba(0,0,0,.5)',
                    transition:'transform .18s, box-shadow .18s',
                  }}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-6px)';e.currentTarget.style.boxShadow='0 20px 44px rgba(0,0,0,.6)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.5)'}}>

                  {/* Gradient art */}
                  <div style={{ height:116, background:g, position:'relative', flexShrink:0 }}>
                    <div style={{ position:'absolute', top:-30, right:-30, width:120, height:120, borderRadius:'50%', border:'1px solid rgba(255,255,255,.07)', pointerEvents:'none' }}/>
                    <div style={{ position:'absolute', bottom:12, right:12, opacity:.12 }}>
                      <svg width={36} height={36} viewBox="0 0 24 24" fill="white"><path d="M9 18V5l12-3v13M6 21a3 3 0 100-6 3 3 0 000 6z"/></svg>
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{ background:'#0c0c0f', padding:'12px 14px 14px', flex:1 }}>
                    {p.type && <div style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.22)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:4 }}>{p.type}</div>}
                    <div style={{ fontSize:14, fontWeight:800, color:'#fff', letterSpacing:'-.3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{p.title}</div>
                    <div style={{ fontSize:10.5, color:'rgba(255,255,255,.22)' }}>{isOwner ? 'Creator' : 'Invited'}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent files list — like "Popular Song" in reference */}
      {projects.length>0 && projectFiles.length>0 && (
        <div style={{ borderRadius:16, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 12px' }}>
            <h3 style={{ margin:0, fontSize:14, fontWeight:800, color:'rgba(255,255,255,.9)', letterSpacing:'-.3px' }}>Recent Stems</h3>
            <button onClick={()=>navigate('/studio')} style={{ background:'none', border:'none', fontSize:12, color:'rgba(255,255,255,.35)', cursor:'pointer', fontWeight:600 }}>Open Studio →</button>
          </div>
          {projectFiles.filter(f=>f.instrument&&f.instrument!=='original'&&f.instrument!=='smart_bounce'&&!pn(f).parent_stem_id).slice(0,5).map((f,i,arr)=>{
            const notes=pn(f), color=STEM_COLORS[f.instrument]||C.coral
            return (
              <div key={f.id}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'11px 20px',
                  borderTop:'1px solid rgba(255,255,255,.04)', cursor:'pointer', transition:'background .1s' }}
                onClick={()=>playTrack(f)}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                {/* Number */}
                <span style={{ fontSize:12, color:'rgba(255,255,255,.2)', fontWeight:600, minWidth:16, textAlign:'right' }}>{i+1}</span>
                {/* Play btn */}
                <button style={{ width:32, height:32, borderRadius:9, flexShrink:0,
                  background:`${color}18`, border:`1px solid ${color}30`,
                  display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color }}>
                  <svg width={9} height={9} viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                </button>
                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'rgba(255,255,255,.88)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {f.suggested_name || f.original_name}
                  </div>
                  <div style={{ fontSize:10.5, color:'rgba(255,255,255,.3)', marginTop:2 }}>
                    {uploaderNames[f.uploaded_by] || 'Unknown'}
                  </div>
                </div>
                {/* BPM + Key */}
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  {notes.bpm && <span style={{ fontSize:10.5, color:'rgba(255,255,255,.3)', fontWeight:600 }}>{Math.round(notes.bpm)} BPM</span>}
                  {notes.key  && <span style={{ fontSize:10.5, color:'rgba(255,255,255,.3)', fontWeight:600 }}>{notes.key}</span>}
                </div>
                {/* Duration */}
                <span style={{ fontSize:11, color:'rgba(255,255,255,.25)', fontWeight:500, minWidth:28, textAlign:'right' }}>
                  {pn(f).duration ? `${Math.floor(pn(f).duration/60)}:${String(Math.floor(pn(f).duration%60)).padStart(2,'0')}` : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      </div>{/* end LEFT */}

      {/* RIGHT PANEL — no boxes, floats on background */}
      <div style={{ display:'flex', flexDirection:'column', gap:24 }}>

        {/* Stats — 3 numbers, no cards, just color + type */}
        <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
          {statCards.map((s, i) => (
            <button key={s.label} onClick={()=>navigate(`/${s.page}`)}
              style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 4px',
                borderBottom: i < statCards.length-1 ? '1px solid rgba(255,255,255,.05)' : 'none',
                background:'transparent', border:'none', cursor:'pointer',
                textAlign:'left', width:'100%', transition:'opacity .12s' }}
              onMouseEnter={e=>e.currentTarget.style.opacity='.75'}
              onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
              {/* Colored accent bar */}
              <div style={{ width:3, height:36, borderRadius:2, background:s.accent,
                boxShadow:`0 0 10px ${s.accent}60`, flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9.5, fontWeight:700, color:'rgba(255,255,255,.28)',
                  textTransform:'uppercase', letterSpacing:'.1em', marginBottom:3 }}>{s.label}</div>
                <div style={{ fontSize:26, fontWeight:900, color:'#fff', letterSpacing:'-1.5px', lineHeight:1 }}>
                  {s.val===null ? <Spinner size={16} color={s.accent}/> : s.val}
                </div>
              </div>
              <div style={{ fontSize:11, color:s.accent, fontWeight:600, opacity:.7 }}>{s.sub}</div>
            </button>
          ))}
        </div>

        {/* Recent Activity — no box, inline timeline */}
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <span style={{ fontSize:11, fontWeight:800, color:'rgba(255,255,255,.35)',
              textTransform:'uppercase', letterSpacing:'.12em' }}>Activity</span>
            <button onClick={()=>navigate('/analytics')}
              style={{ background:'none', border:'none', fontSize:11, color:C.coral,
                cursor:'pointer', fontWeight:600 }}>See all</button>
          </div>

          {loadingDetail ? <Spinner size={14}/>
          : projectFiles.length===0 ? (
            <p style={{ margin:0, fontSize:12, color:'rgba(255,255,255,.2)' }}>No activity yet.</p>
          ) : (() => {
            const events=[], seenParent=new Set()
            const sorted=[...projectFiles].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
            for (const f of sorted) {
              const n=pn(f)
              if (n.parent_stem_id) {
                if (!seenParent.has(n.parent_stem_id)) { seenParent.add(n.parent_stem_id); const sib=projectFiles.filter(x=>pn(x).parent_stem_id===n.parent_stem_id); events.push({type:'separation',id:`sep_${n.parent_stem_id}`,f,count:sib.length,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Someone'}) }
              } else if (f.instrument==='smart_bounce') {
                events.push({type:'bounce',id:f.id,f,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Dizko.ai'})
              } else if (f.instrument&&f.instrument!=='original') {
                events.push({type:'upload',id:f.id,f,created_at:f.created_at,who:uploaderNames[f.uploaded_by]||'Someone'})
              }
              if (events.length>=6) break
            }
            const dc = ev => ev.type==='bounce'?'#22c55e':ev.type==='separation'?C.amber:(STEM_COLORS[ev.f.instrument]||C.coral)
            return events.slice(0,5).map((ev, i) => (
              <div key={ev.id} style={{ display:'flex', gap:12, alignItems:'flex-start',
                paddingBottom:14, marginBottom: i < 4 ? 14 : 0,
                borderBottom: i < 4 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                {/* Colored dot */}
                <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                  background:dc(ev), marginTop:4,
                  boxShadow: ev.type==='bounce' ? `0 0 8px ${dc(ev)}` : 'none' }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ margin:0, fontSize:12.5, color:'rgba(255,255,255,.65)', lineHeight:1.5 }}>
                    <strong style={{ color:'rgba(255,255,255,.88)', fontWeight:700 }}>{ev.who}</strong>
                    {ev.type==='upload' && <> uploaded <span style={{ color:dc(ev) }}>{ev.f.instrument||'a file'}</span></>}
                    {ev.type==='separation' && <> split <span style={{ color:C.amber }}>{ev.count} stems</span></>}
                    {ev.type==='bounce' && <> updated the <span style={{ color:'#22c55e' }}>session mix</span></>}
                  </p>
                  <span style={{ fontSize:10.5, color:'rgba(255,255,255,.22)' }}>{timeAgo(ev.created_at)}</span>
                </div>
              </div>
            ))
          })()}
        </div>

      </div>{/* end RIGHT */}

      </div>{/* end 2-col grid */}
    </>
  )
}