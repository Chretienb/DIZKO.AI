import React, { useState, useEffect, useMemo } from 'react'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, youtubeApi, venuesApi } from '../lib/api.js'
import { Spinner } from '../components/ui/index.jsx'
import { C } from '../components/ui/index.jsx'

// ── Constants ────────────────────────────────────────────────────────────────
const CHART_PALETTE = ['#F4937A','#E8709A','#6366f1','#a855f7','#22c55e','#06b6d4','#f59e0b','#94a3b8']
const STEM_COLORS = { vocals:'#E8709A', drums:'#F4937A', bass:'#6366f1', guitar:'#a855f7', keys:'#22c55e', piano:'#22c55e', synth:'#06b6d4', original:'#94a3b8', smart_bounce:'#f59e0b', other:'#cbd5e1' }
const stemColor = k => STEM_COLORS[k?.toLowerCase?.()] || '#94a3b8'
const COUNTRY_NAMES = { US:'United States', GB:'United Kingdom', CA:'Canada', AU:'Australia', FR:'France', DE:'Germany', BR:'Brazil', MX:'Mexico', NG:'Nigeria', JP:'Japan', KR:'South Korea', IN:'India', ZA:'South Africa', ES:'Spain', IT:'Italy', NL:'Netherlands', SE:'Sweden', NO:'Norway', DK:'Denmark', GH:'Ghana' }
const countryName = code => COUNTRY_NAMES[code] || code

// ── Sub-components ────────────────────────────────────────────────────────────
function LoadingBlock({ label, size = 22 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'36px 20px', color:C.t3 }}>
      <Spinner size={size}/>
      {label && <span style={{ fontSize:12.5, fontWeight:500 }}>{label}</span>}
    </div>
  )
}

function AnalyticsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:10, padding:'10px 14px', boxShadow:'0 4px 20px rgba(0,0,0,.4)', fontSize:12 }}>
      {label && <div style={{ fontWeight:700, color:C.t1, marginBottom:6 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, color:C.t2, marginTop: i ? 3 : 0 }}>
          <div style={{ width:8, height:8, borderRadius:2, background:p.color || p.fill, flexShrink:0 }}/>
          <span style={{ textTransform:'capitalize' }}>{p.name}</span>
          <span style={{ fontWeight:800, color:C.t1, marginLeft:'auto', paddingLeft:16 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PageAnalytics({ onGated, hasAccess }) {
  const [projects, setProjects] = useState([])
  const [allFiles, setAllFiles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const isMobile = React.useContext(MobileCtx)

  // Last.fm
  const [lfmArtist,  setLfmArtist]  = useState('')
  const [lfmData,    setLfmData]    = useState(null)
  const [lfmLoading, setLfmLoading] = useState(false)
  const [lfmError,   setLfmError]   = useState('')

  const loadLastFm = async () => {
    if (!lfmArtist.trim()) return
    setLfmLoading(true); setLfmError(''); setLfmData(null)
    try {
      const res = await fetch(`/api/analytics/lastfm?artist=${encodeURIComponent(lfmArtist.trim())}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('disco_token')||''}` } })
      const j = await res.json()
      if (j.error) setLfmError(j.error)
      else setLfmData(j.data)
    } catch { setLfmError('Request failed') }
    setLfmLoading(false)
  }

  // YouTube
  const [ytConnected,    setYtConnected]    = useState(false)
  const [ytData,         setYtData]         = useState(null)
  const [ytLoading,      setYtLoading]      = useState(false)
  const [ytVenueLoad,    setYtVenueLoad]    = useState(false)
  const [selectedYtCity, setSelectedYtCity] = useState(null)
  const [ytCityVenues,   setYtCityVenues]   = useState({})

  useEffect(() => {
    youtubeApi.status().then(r => {
      const connected = r.data?.connected ?? false
      setYtConnected(connected)
      if (connected) {
        setYtLoading(true)
        youtubeApi.analytics()
          .then(r => {
            if (r.data) {
              setYtData(r.data)
              const topCity = r.data.cities?.[0]?.city
              if (topCity) {
                setSelectedYtCity(topCity)
                setYtVenueLoad(true)
                venuesApi.search(topCity)
                  .then(v => setYtCityVenues(prev => ({ ...prev, [topCity]: v.data || [] })))
                  .finally(() => setYtVenueLoad(false))
              }
            }
          })
          .catch(e => console.warn('[yt]', e?.message))
          .finally(() => setYtLoading(false))
      }
    }).catch(e => console.warn('[yt]', e?.message))
  }, [])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('yt') === 'connected') {
      window.history.replaceState({}, '', '/analytics')
      setYtConnected(true)
      setYtLoading(true)
      youtubeApi.analytics()
        .then(r => { if (r.data) setYtData(r.data) })
        .catch(e => console.warn('[yt]', e?.message))
        .finally(() => setYtLoading(false))
    }
  }, [])

  const connectYoutube = async () => {
    if (!hasAccess) { onGated?.(); return }
    const res = await fetch('/api/youtube/connect', {
      headers: { Authorization: `Bearer ${localStorage.getItem('disco_token') || ''}`, 'Cache-Control': 'no-cache' }
    }).then(r => r.json()).catch(e => { console.error('[YT]', e.message); return null })
    const url = res?.data?.url
    if (url) window.location.href = url
  }

  const loadYtVenuesForCity = (city) => {
    setSelectedYtCity(city)
    if (ytCityVenues[city]) return
    setYtVenueLoad(true)
    venuesApi.search(city)
      .then(v => setYtCityVenues(prev => ({ ...prev, [city]: v.data || [] })))
      .catch(e => console.warn('[venues]', e?.message))
      .finally(() => setYtVenueLoad(false))
  }

  // Project data
  useEffect(() => {
    projectsApi.list()
      .then(async res => {
        const projs = res.data || []
        setProjects(projs)
        if (!projs.length) return
        const fileResults = await Promise.all(projs.map(p => filesApi.list(p.id).catch(() => ({ data: [] }))))
        setAllFiles(fileResults.flatMap((r, i) => (r.data || []).map(f => ({ ...f, projectTitle: projs[i].title, projectId: projs[i].id }))))
      })
      .finally(() => setLoading(false))
  }, [])

  const byInstrument = useMemo(() => {
    const acc = {}
    allFiles.forEach(f => { const k = f.instrument || 'other'; acc[k] = (acc[k] || 0) + 1 })
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  }, [allFiles])

  const byProject = useMemo(() =>
    projects.map((p, i) => ({
      name: p.title.length > 18 ? p.title.slice(0, 16) + '…' : p.title,
      fullName: p.title,
      files: allFiles.filter(f => f.projectId === p.id).length,
      fill: CHART_PALETTE[i % CHART_PALETTE.length],
    })), [projects, allFiles])

  const activityByDay = useMemo(() => {
    const days = {}
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days[key] = { date: key, uploads: 0, label: d.toLocaleDateString('en', { month:'short', day:'numeric' }) }
    }
    allFiles.forEach(f => { const key = f.created_at?.slice(0, 10); if (key && days[key]) days[key].uploads++ })
    return Object.values(days)
  }, [allFiles])

  const totalFiles     = allFiles.length
  const totalProjects  = projects.length
  const uniqueContribs = new Set(allFiles.map(f => f.uploaded_by).filter(Boolean)).size
  const mostActiveProj = [...byProject].sort((a, b) => b.files - a.files)[0]
  const isEmpty        = !loading && allFiles.length === 0

  const statCards = [
    { label:'Total Files',  val: totalFiles,     icon:'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7', color:'#6366f1' },
    { label:'Projects',     val: totalProjects,  icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z', color: C.coral },
    { label:'Contributors', val: uniqueContribs, icon:'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z', color:'#a855f7' },
    { label:'Most Active',  val: mostActiveProj?.files ?? 0, sub: mostActiveProj?.fullName, icon:'M18 20V10M12 20V4M6 20v-6', color:'#22c55e' },
  ]

  return (
    <>
      {/* YouTube */}
      <div style={{ borderRadius:24, overflow:'hidden', marginBottom:24,
        background: ytConnected ? C.surface : 'linear-gradient(135deg,#0f0f14 0%,#1a0820 60%,#0a1018 100%)',
        boxShadow: ytConnected ? '0 4px 20px rgba(0,0,0,.3)' : '0 8px 40px rgba(0,0,0,.25)',
        border: ytConnected ? `1px solid ${C.border}` : 'none', position:'relative' }}>

        {!ytConnected && <>
          <div style={{ position:'absolute', top:'-20%', right:'-5%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,0,0,.18) 0%,transparent 65%)', pointerEvents:'none' }}/>
          <div style={{ position:'absolute', bottom:'-10%', left:'15%', width:300, height:300, borderRadius:'50%', background:`radial-gradient(circle,${C.coral}18 0%,transparent 65%)`, pointerEvents:'none' }}/>
        </>}

        {!ytConnected ? (
          <div style={{ position:'relative', padding:'48px 40px', display:'flex', alignItems:'center', gap:32, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:240 }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'5px 14px', borderRadius:100, background:'rgba(255,0,0,.12)', border:'1px solid rgba(255,0,0,.25)', marginBottom:20 }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="#ff4444"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                <span style={{ fontSize:11, fontWeight:700, color:'#ff6666', letterSpacing:'.06em', textTransform:'uppercase' }}>YouTube Analytics</span>
              </div>
              <h2 style={{ margin:'0 0 12px', fontSize: isMobile ? 28 : 40, fontWeight:900, color:'#fff', letterSpacing:'-1.5px', lineHeight:1.1 }}>
                Know exactly<br/>
                <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>where your fans are.</span>
              </h2>
              <p style={{ margin:'0 0 28px', fontSize:15, color:'rgba(255,255,255,.4)', lineHeight:1.7, maxWidth:420 }}>
                Connect your YouTube channel to see which cities are watching your music — then find venues nearby where you could perform.
              </p>
              <div style={{ display:'flex', gap:20, flexWrap:'wrap', marginBottom:28 }}>
                {['Views by country & city','Last 90 days of data','Venue recommendations near fans'].map(f => (
                  <div key={f} style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, color:'rgba(255,255,255,.5)' }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                    {f}
                  </div>
                ))}
              </div>
              <button onClick={connectYoutube}
                style={{ padding:'14px 28px', borderRadius:14, border:'none', cursor:'pointer', background:'#ff0000', color:'#fff', fontSize:15, fontWeight:800, letterSpacing:'-.2px', display:'inline-flex', alignItems:'center', gap:10, boxShadow:'0 6px 28px rgba(255,0,0,.45)', transition:'transform .15s, box-shadow .15s' }}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 10px 36px rgba(255,0,0,.55)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 6px 28px rgba(255,0,0,.45)'}}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#fff"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                Connect YouTube
              </button>
            </div>
            {!isMobile && (
              <div style={{ display:'flex', flexDirection:'column', gap:12, flexShrink:0 }}>
                {[{label:'Countries reached',val:'47'},{label:'Cities tracked',val:'120+'},{label:'Venue matches',val:'∞'}].map(s => (
                  <div key={s.label} style={{ padding:'16px 22px', borderRadius:16, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)', backdropFilter:'blur(12px)' }}>
                    <div style={{ fontSize:28, fontWeight:900, color:'#fff', letterSpacing:'-1px' }}>{s.val}</div>
                    <div style={{ fontSize:12, color:C.t3, marginTop:4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : ytLoading ? (
          <div style={{ padding:'40px', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <LoadingBlock label="Loading your YouTube analytics…"/>
          </div>
        ) : ytData ? (
          <div style={{ padding:'28px 32px' }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:12 }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="#ff0000"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                  <span style={{ fontSize:11, fontWeight:700, color:'#ff4444', textTransform:'uppercase', letterSpacing:'.08em' }}>YouTube Analytics · Last 90 days</span>
                </div>
                <h2 style={{ margin:'0 0 4px', fontSize: isMobile?22:32, fontWeight:900, color:C.t1, letterSpacing:'-1.2px', lineHeight:1.1 }}>
                  Your fans are in{' '}
                  <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                    {ytData.cities?.slice(0,3).map(c=>c.city).join(', ') || ytData.countries?.slice(0,3).map(c=>countryName(c.country_code)).join(', ') || 'the world'}
                  </span>
                </h2>
                <div style={{ fontSize:13, color:C.t2 }}>{ytData.countries?.reduce((s,c)=>s+c.views,0)?.toLocaleString() || '—'} total views across {ytData.countries?.length || 0} countries</div>
              </div>
              <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                {[{label:'Top country',val:countryName(ytData.countries?.[0]?.country_code||'')||'—'},{label:'Total views',val:ytData.countries?.reduce((s,c)=>s+c.views,0)?.toLocaleString()||'—'}].map(s => (
                  <div key={s.label} style={{ textAlign:'right' }}>
                    <div style={{ fontSize:22, fontWeight:900, color:C.t1, letterSpacing:'-1px' }}>{s.val}</div>
                    <div style={{ fontSize:11, color:C.t3, marginTop:2 }}>{s.label}</div>
                  </div>
                ))}
                <button onClick={()=>{setYtConnected(false);youtubeApi.disconnect()}} style={{ alignSelf:'flex-start', fontSize:11, color:C.t3, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', cursor:'pointer' }}>Disconnect</button>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:24 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Views by Country</div>
                {(ytData.countries||[]).slice(0,8).map((c,i) => {
                  const max = ytData.countries[0]?.views||1
                  return (
                    <div key={c.country_code} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:C.t2, width:140, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{countryName(c.country_code)}</span>
                      <div style={{ flex:1, height:7, borderRadius:4, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
                        <div style={{ width:`${(c.views/max)*100}%`, height:'100%', borderRadius:4, background: i===0?'#ff0000':i===1?'#ff4444':C.coral, transition:'width .5s' }}/>
                      </div>
                      <span style={{ fontSize:12, fontWeight:800, color:C.t1, width:48, textAlign:'right', flexShrink:0 }}>{c.views>=1000?`${(c.views/1000).toFixed(1)}k`:c.views}</span>
                    </div>
                  )
                })}
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Top Cities — tap to find venues</div>
                {(ytData.cities||[]).length === 0 ? (
                  <div style={{ padding:'20px', borderRadius:14, background:'rgba(255,255,255,.03)', textAlign:'center' }}>
                    <div style={{ fontSize:13, color:C.t2, marginBottom:6 }}>City data coming soon</div>
                    <div style={{ fontSize:12, color:C.t3 }}>Needs more views to unlock city-level data</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:16 }}>
                      {(ytData.cities||[]).slice(0,6).map(c => (
                        <button key={c.city} onClick={()=>loadYtVenuesForCity(c.city)}
                          style={{ padding:'6px 14px', borderRadius:100, fontSize:12.5, fontWeight:700, cursor:'pointer', background:selectedYtCity===c.city?'#ff0000':'rgba(255,255,255,.06)', color:selectedYtCity===c.city?'#fff':C.t2, border:selectedYtCity===c.city?'none':`1px solid ${C.border}`, transition:'all .15s' }}>
                          {c.city} <span style={{ opacity:.55, fontSize:10, marginLeft:5 }}>{c.views>=1000?`${(c.views/1000).toFixed(0)}k`:c.views}</span>
                        </button>
                      ))}
                    </div>
                    {selectedYtCity && (ytVenueLoad ? <LoadingBlock/> : (ytCityVenues[selectedYtCity]||[]).length===0 ? (
                      <div style={{ fontSize:13, color:C.t3, padding:'12px' }}>No music venues found in {selectedYtCity}</div>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {(ytCityVenues[selectedYtCity]||[]).slice(0,4).map(v => (
                          <a key={v.id} href={v.url||'#'} target="_blank" rel="noopener noreferrer"
                            style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:14, background:'rgba(255,255,255,.04)', border:`1px solid ${C.border}`, textDecoration:'none', transition:'all .15s' }}
                            onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,0,0,.06)';e.currentTarget.style.borderColor='rgba(255,0,0,.25)'}}
                            onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.04)';e.currentTarget.style.borderColor=C.border}}>
                            <div style={{ width:34, height:34, borderRadius:10, background:'rgba(255,0,0,.1)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth={2} strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13.5, fontWeight:700, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.name}</div>
                              <div style={{ fontSize:11.5, color:C.t2, marginTop:2 }}>{v.address||`${v.city}, ${v.state}`}</div>
                            </div>
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                          </a>
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Project Stats */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:16 }}>Project Stats</div>
        {loading ? <LoadingBlock/> : isEmpty ? (
          <div style={{ textAlign:'center', padding:'60px 24px', background:C.surface, borderRadius:20, border:`1px solid ${C.border}`, boxShadow:'0 4px 20px rgba(0,0,0,.3)' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:10 }}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
            <div style={{ fontSize:14, fontWeight:700, color:C.t1, marginBottom:5 }}>No data yet</div>
            <div style={{ fontSize:12, color:C.t3 }}>Upload files to your projects to see stats here</div>
          </div>
        ) : (
          <>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12, marginBottom:16 }}>
              {statCards.map(s => (
                <div key={s.label} style={{ background:C.surface, borderRadius:16, padding:'16px 18px', boxShadow:'0 4px 20px rgba(0,0,0,.3)', border:`1px solid ${C.border}` }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                    <span style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.07em' }}>{s.label}</span>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${s.color}12`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round"><path d={s.icon}/></svg>
                    </div>
                  </div>
                  <div style={{ fontSize:28, fontWeight:900, color:C.t1, letterSpacing:'-1.2px', lineHeight:1 }}>{s.val}</div>
                  {s.sub && <div style={{ fontSize:11, color:s.color, fontWeight:600, marginTop:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            <div style={{ background:C.surface, borderRadius:20, padding:'20px 24px', marginBottom:16, boxShadow:'0 4px 20px rgba(0,0,0,.3)', border:`1px solid ${C.border}` }}>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:14, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>Upload Activity</div>
                <div style={{ fontSize:12, color:C.t3, marginTop:2 }}>Files uploaded per day — last 30 days</div>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={activityByDay} margin={{ top:4, right:4, bottom:0, left:-20 }}>
                  <defs>
                    <linearGradient id="uploadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.coral} stopOpacity={0.25}/>
                      <stop offset="95%" stopColor={C.coral} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false}/>
                  <XAxis dataKey="label" tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false} interval={Math.floor(activityByDay.length/6)}/>
                  <YAxis tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false} allowDecimals={false}/>
                  <Tooltip content={<AnalyticsTooltip/>} cursor={{ stroke:'rgba(255,255,255,.1)', strokeWidth:1 }}/>
                  <Area type="monotone" dataKey="uploads" name="Uploads" stroke={C.coral} strokeWidth={2} fill="url(#uploadGrad)" dot={false} activeDot={{ r:4, fill:C.coral, strokeWidth:0 }}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:16 }}>
              <div style={{ background:C.surface, borderRadius:20, padding:'20px 24px', boxShadow:'0 4px 20px rgba(0,0,0,.3)', border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:14, fontWeight:800, color:C.t1, marginBottom:4 }}>Stem Types</div>
                <div style={{ fontSize:12, color:C.t3, marginBottom:16 }}>Breakdown by instrument</div>
                <div style={{ display:'flex', alignItems:'center', gap:20 }}>
                  <ResponsiveContainer width={130} height={130}>
                    <PieChart>
                      <Pie data={byInstrument} cx="50%" cy="50%" innerRadius={38} outerRadius={60} paddingAngle={2} dataKey="value" strokeWidth={0}>
                        {byInstrument.map((entry,i) => <Cell key={entry.name} fill={stemColor(entry.name)}/>)}
                      </Pie>
                      <Tooltip content={<AnalyticsTooltip/>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                    {byInstrument.slice(0,6).map(e => (
                      <div key={e.name} style={{ display:'flex', alignItems:'center', gap:7 }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:stemColor(e.name), flexShrink:0 }}/>
                        <span style={{ fontSize:11.5, color:C.t2, textTransform:'capitalize', flex:1 }}>{e.name.replace(/_/g,' ')}</span>
                        <span style={{ fontSize:11.5, fontWeight:800, color:C.t1 }}>{e.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ background:C.surface, borderRadius:20, padding:'20px 24px', boxShadow:'0 4px 20px rgba(0,0,0,.3)', border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:14, fontWeight:800, color:C.t1, marginBottom:4 }}>Files per Project</div>
                <div style={{ fontSize:12, color:C.t3, marginBottom:16 }}>Total uploads per project</div>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={byProject} margin={{ top:4, right:4, bottom:0, left:-20 }} barSize={16}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false}/>
                    <XAxis dataKey="name" tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false} allowDecimals={false}/>
                    <Tooltip content={<AnalyticsTooltip/>} cursor={{ fill:'rgba(255,255,255,.04)' }}/>
                    <Bar dataKey="files" name="Files" radius={[5,5,0,0]}>
                      {byProject.map((e,i) => <Cell key={i} fill={e.fill}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Last.fm */}
      <div style={{ background:C.surface, borderRadius:20, padding:'22px', border:`1px solid ${C.border}`, marginTop:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="#d51007"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm5.5 17.2c-.2.3-.6.4-1 .2-2.7-1.6-6.1-2-10.1-1.1-.4.1-.7-.2-.8-.5-.1-.4.2-.7.5-.8 4.4-1 8.2-.6 11.2 1.3.4.1.4.6.2.9zm1.4-3.2c-.3.4-.8.5-1.2.3-3.1-1.9-7.8-2.4-11.5-1.3-.5.1-1-.1-1.1-.6-.1-.5.1-1 .6-1.1 4.2-1.3 9.4-.7 13 1.5.5.2.6.8.2 1.2zm.1-3.3C15.4 8.5 8.5 8.3 5.1 9.3c-.6.2-1.2-.2-1.3-.7-.2-.6.2-1.2.7-1.3 4-1.1 10.8-.9 15 1.5.5.3.7 1 .4 1.5-.3.4-1 .6-1.4.4z"/></svg>
            <span style={{ fontSize:15, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>Last.fm</span>
          </div>
          <span style={{ fontSize:11, color:C.t3 }}>No account needed</span>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:16, background:C.surface2, borderRadius:12, border:`1px solid ${C.border}`, padding:'4px', alignItems:'center' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2.5} strokeLinecap="round" style={{ marginLeft:10, flexShrink:0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input placeholder="Artist name…" value={lfmArtist} onChange={e=>setLfmArtist(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadLastFm()}
            style={{ flex:1, padding:'9px 8px', background:'transparent', border:'none', outline:'none', fontSize:13, fontFamily:'inherit', color:C.t1 }}/>
          <button onClick={loadLastFm} disabled={lfmLoading||!lfmArtist.trim()}
            style={{ padding:'8px 16px', borderRadius:9, border:'none', background:lfmArtist.trim()?C.grad:'transparent', color:lfmArtist.trim()?'#fff':C.t3, fontSize:12, fontWeight:700, cursor:lfmArtist.trim()?'pointer':'default', transition:'all .15s' }}>
            {lfmLoading?<Spinner size={11} color="#fff"/>:'Search'}
          </button>
        </div>
        {lfmError&&<div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)', fontSize:13, color:'#f87171', marginBottom:12 }}>{lfmError}</div>}
        {lfmData&&(
          <div>
            <div style={{ display:'flex', gap:14, alignItems:'flex-start', marginBottom:18, padding:'16px', borderRadius:14, background:C.surface2, border:`1px solid ${C.border}` }}>
              {lfmData.image&&<img src={lfmData.image} alt="" style={{ width:60, height:60, borderRadius:12, objectFit:'cover', flexShrink:0 }}/>}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:19, fontWeight:900, color:C.t1, letterSpacing:'-.5px', marginBottom:5 }}>{lfmData.name}</div>
                <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                  {lfmData.tags?.map(t=><span key={t} style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:100, background:'rgba(255,255,255,.07)', border:`1px solid ${C.border}`, color:C.t2, textTransform:'capitalize' }}>{t}</span>)}
                </div>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
              {[{label:'Monthly Listeners',val:lfmData.listeners,sub:'on Last.fm'},{label:'Total Plays',val:lfmData.playcount,sub:'all time'}].map((s,i)=>(
                <div key={i} style={{ padding:'14px 16px', borderRadius:12, background:C.surface2, border:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:24, fontWeight:900, color:C.t1, letterSpacing:'-1px', lineHeight:1 }}>
                    {s.val>=1000000?`${(s.val/1000000).toFixed(1)}M`:s.val>=1000?`${(s.val/1000).toFixed(s.val>=10000?0:1)}K`:s.val.toLocaleString()}
                  </div>
                  <div style={{ fontSize:11, fontWeight:600, color:C.t3, marginTop:4 }}>{s.label}</div>
                  <div style={{ fontSize:10, color:C.t3 }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {lfmData.bio&&<p style={{ fontSize:13, color:C.t2, lineHeight:1.7, marginBottom:18, borderLeft:`3px solid ${C.border}`, paddingLeft:12 }}>{lfmData.bio.slice(0,260)}{lfmData.bio.length>260?'…':''}</p>}
            {lfmData.top_tracks?.length>0&&(
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>Top Tracks</div>
                {lfmData.top_tracks.map((t,i)=>(
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 10px', borderRadius:9, transition:'background .1s' }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.05)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{ fontSize:11, color:C.t3, fontWeight:700, minWidth:18, textAlign:'right' }}>{i+1}</span>
                    <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</span>
                    <span style={{ fontSize:11, color:C.t3, flexShrink:0 }}>{t.playcount>=1000000?`${(t.playcount/1000000).toFixed(1)}M`:t.playcount>=1000?`${(t.playcount/1000).toFixed(0)}K`:t.playcount>0?t.playcount:'—'}</span>
                  </div>
                ))}
              </div>
            )}
            <a href={lfmData.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize:12, color:'#d51007', fontWeight:700, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:4 }}>
              Open on Last.fm <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        )}
      </div>
    </>
  )
}
