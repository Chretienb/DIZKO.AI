import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MotionConfig, motion } from 'motion/react'
import { Plus, Search, X, Heart, Archive } from 'lucide-react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, collaborators as collabsApi } from '../lib/api.js'
import { Button } from '../components/ui/button.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { Input } from '../components/ui/input.jsx'
import { Skeleton } from '../components/ui/skeleton.jsx'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.jsx'
import { timeAgo } from '../lib/utils.js'
import Cover from '../components/Cover.jsx'
import ProjectCard from '../components/ProjectCard.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import Hero from '../components/dashboard/Hero.jsx'
import astronautImg from '../assets/empty/astronaut-studio.jpg'
import ufoImg       from '../assets/empty/ufo-no-projects.jpg'

// ── Helpers ───────────────────────────────────────────────────────────────────
function pn(f) { try { return JSON.parse(f?.notes || '{}') } catch { return {} } }
function fmtDur(s) { if (!s) return '—'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` }

const STEM_COLORS = {
  vocals:'#8B7CF6', drums:'#EF4444', bass:'#22C55E', guitar:'#F5C97A',
  keys:'#8B7CF6', synth:'#8B7CF6', harmony:'#C084FC', recording:'#EF4444',
  other:'var(--t3)', smart_bounce:'#22C55E',
}

const TABS = [['upnext','Up Next'], ['stems','Stems'], ['people','People'], ['activity','Activity']]

const EASE = [0.25, 0.6, 0.3, 1]
const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, ease: EASE, delay },
})

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
  const [showArchive, setShowArchive] = useState(false)
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
      // Keep ALL projects — the Dashboard is the only projects surface now
      // (the standalone Projects/Library pages were retired), so the archive
      // lives here too, behind a toggle in the grid header. Hero/rail still
      // work off active projects only.
      const list = r.data || []
      setProjects(list)
      const firstActive = list.find(p => p.status !== 'Archived')
      if (firstActive) setSelId(firstActive.id)
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
  // Contributors = people you've ADDED, not yourself (the collaborators list
  // includes the owner as a synthetic 'owner' entry).
  const contributors = collabs.filter(c => c.role !== 'owner').length

  const people = (() => {
    const m = new Map()
    collabs.forEach(c => { const nm = c.user?.full_name || c.user?.email?.split('@')[0] || 'Collaborator'; m.set(c.user_id || nm, { name:nm, role:c.role || 'Collaborator' }) })
    Object.entries(uploaders).forEach(([uid, nm]) => { if (!m.has(uid)) m.set(uid, { name:nm, role:'Contributor' }) })
    return [...m.values()]
  })()

  const activity = [...files].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,8).map(f => ({
    id:f.id, who:uploaders[f.uploaded_by]||'Someone', what:f.instrument||'a file', when:f.created_at,
    color:STEM_COLORS[f.instrument]||'var(--brand)',
  }))

  const q = search.toLowerCase()
  const activeProjects   = projects.filter(p => p.status !== 'Archived')
  const archivedProjects = projects.filter(p => p.status === 'Archived')
  const gridSource = showArchive ? archivedProjects : activeProjects
  const projList = gridSource.filter(p => !q || p.title.toLowerCase().includes(q))
  const railProjects = activeProjects.filter(p => !q || p.title.toLowerCase().includes(q))
  const stemList = parentStems.filter(f => !q || (f.suggested_name||f.original_name||'').toLowerCase().includes(q))

  // Skeleton mirrors the real layout (header → hero → grid+rail) so the page
  // doesn't jump when data lands — reads far more premium than a spinner.
  if (loading) return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:22 }}>
        <Skeleton className="h-8 w-44"/>
        <Skeleton className="h-9 w-32 rounded-full"/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '340px 1fr', gap:32, padding:28,
        background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-3)' }}>
        <Skeleton className="aspect-square w-full rounded-xl"/>
        <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', gap:14 }}>
          <Skeleton className="h-3 w-36"/>
          <Skeleton className="h-9 w-3/5"/>
          <Skeleton className="h-4 w-44"/>
          <div style={{ display:'flex', gap:10, marginTop:8 }}>
            <Skeleton className="h-10 w-32 rounded-full"/>
            <Skeleton className="h-10 w-40 rounded-full"/>
          </div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:14, marginTop:24 }}>
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="aspect-[5/6] w-full rounded-xl"/>)}
      </div>
    </div>
  )

  // ── Rail row renderers (Up Next / Stems / People / Activity) ──
  const listRow = ({ key, onClick, cover, title, sub, right, favId }) => (
    <div key={key} className="dz-row" onClick={onClick}
      style={{ display:'grid', gridTemplateColumns:`36px 1fr auto${favId ? ' 26px' : ''}`, alignItems:'center', gap:11,
        padding:'7px 10px', borderRadius:'var(--r-1)', cursor: onClick ? 'pointer' : 'default',
        transition:'background var(--dur-1) var(--ease)' }}>
      {cover}
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</div>
        {sub && <div style={{ fontSize:11.5, color:'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sub}</div>}
      </div>
      {right}
      {favId && (
        <button
          aria-label={favs.has(favId) ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={favs.has(favId)}
          onClick={e => { e.stopPropagation(); toggleFav(favId) }}
          className={`dz-heart ${favs.has(favId) ? 'on' : ''}`}
          style={{ background:'none', border:'none', cursor:'pointer', padding:3, display:'flex',
            color: favs.has(favId) ? 'var(--brand)' : 'var(--t4)' }}>
          <Heart size={13} fill={favs.has(favId) ? 'currentColor' : 'none'}/>
        </button>
      )}
    </div>
  )

  const railList = (
    <div className="scroll-fade-b scrollbar-none" style={{ flex:1, minHeight:0, overflowY:'auto', padding:'6px 8px 10px', display:'flex', flexDirection:'column', gap:1 }}>
      {tab === 'upnext' && (railProjects.length ? railProjects.map(p => listRow({
        key:p.id,
        onClick:() => { setSelId(p.id); setTab('upnext') },
        cover:<Cover seed={p.id} size={36} radius={7} coverUrl={p.cover_url}/>,
        title:p.title, sub:p.type || 'Single',
        right:<Badge variant="outline" className="justify-self-end text-[10px] px-1.5 py-0 text-[color:var(--t3)]">{p.status || 'Draft'}</Badge>,
        favId:p.id,
      })) : (
        <div style={{ padding:'28px 16px', textAlign:'center', color:'var(--t3)', fontSize:12.5 }}>No projects yet.</div>
      ))}
      {tab === 'stems' && (stemList.length ? stemList.map(f => listRow({
        key:f.id,
        onClick:() => playTrack(f),
        cover:<Cover seed={f.id} size={36} radius={7}/>,
        title:f.suggested_name || f.original_name, sub:uploaders[f.uploaded_by] || 'Unknown',
        right:<span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--t4)', justifySelf:'end' }}>{fmtDur(pn(f).duration)}</span>,
        favId:f.id,
      })) : <div style={{ padding:'28px 16px', textAlign:'center', color:'var(--t3)', fontSize:12.5 }}>No stems in this project.</div>)}
      {tab === 'people' && (people.length ? people.map((p, i) => listRow({
        key:i,
        cover:<Avatar name={p.name} size={36} border="none"/>,
        title:p.name, sub:p.role,
      })) : <div style={{ padding:'28px 16px', textAlign:'center', color:'var(--t3)', fontSize:12.5 }}>No people yet.</div>)}
      {tab === 'activity' && (activity.length ? activity.map((a, i) => (
        <div key={a.id} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 10px',
          borderBottom: i < activity.length-1 ? '1px solid var(--border-2)' : 'none' }}>
          <span aria-hidden="true" style={{ width:6, height:6, borderRadius:'50%', background:a.color, flexShrink:0, marginTop:5 }}/>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:'0 0 2px', fontSize:12, color:'var(--t2)', lineHeight:1.5 }}>
              <strong style={{ color:'var(--t1)', fontWeight:600 }}>{a.who}</strong> uploaded {a.what}
            </p>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--t4)' }}>{timeAgo(a.when)}</span>
          </div>
        </div>
      )) : <div style={{ padding:'28px 16px', textAlign:'center', color:'var(--t3)', fontSize:12.5 }}>No activity yet.</div>)}
    </div>
  )

  const hasProjects = activeProjects.length > 0

  return (
    <MotionConfig reducedMotion="user">
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <style>{`
          .dz-row:hover { background: var(--hover); }
          .dz-row .dz-heart { opacity: 0; transition: opacity .15s; }
          .dz-row:hover .dz-heart, .dz-row .dz-heart.on { opacity: 1; }
        `}</style>

        {/* ── Page header ── */}
        <motion.div {...rise(0)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, margin:'0 0 22px' }}>
          <h1 style={{ margin:0, fontSize:isMobile ? 22 : 26, fontWeight:650, color:'var(--t1)', letterSpacing:'-.7px' }}>Dashboard</h1>
          <Button variant="brand" onClick={() => openModal('new-project', {})}>
            <Plus/>
            New Project
          </Button>
        </motion.div>

        {/* ── Hero: Continue Creating (or premium empty state) ── */}
        {hasProjects && selProject ? (
          <motion.div {...rise(0.05)}>
            <Hero project={selProject} stemCount={parentStems.length} contributorCount={contributors}
              onResume={() => navigate(`/projects/${selProject.id}`)}
              onOpenStudio={() => navigate('/studio')}
              isMobile={isMobile}/>
          </motion.div>
        ) : (
          <motion.section {...rise(0.05)} aria-label="Get started" style={{ position:'relative', borderRadius:'var(--r-3)',
            overflow:'hidden', border:'1px solid var(--border)', boxShadow:'var(--shadow-1)', minHeight: isMobile ? 300 : 360 }}>
            <div style={{ position:'absolute', inset:0, background:`#000 center/cover no-repeat url(${astronautImg})` }}/>
            <div style={{ position:'absolute', inset:0,
              background:'linear-gradient(to top, rgba(13,13,15,.92) 0%, rgba(13,13,15,.45) 55%, rgba(109,90,230,.18) 100%)' }}/>
            <div style={{ position:'relative', display:'flex', flexDirection:'column', alignItems:'flex-start',
              justifyContent:'flex-end', minHeight:'inherit', padding: isMobile ? 20 : 32 }}>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:11, fontWeight:500, letterSpacing:'.16em',
                textTransform:'uppercase', color:'#B6AAFF', marginBottom:10 }}>
                Welcome to Dizko
              </div>
              <h2 style={{ margin:'0 0 8px', fontSize:isMobile ? 26 : 34, fontWeight:650, letterSpacing:'-1px', color:'#fff' }}>
                Your next hit starts here
              </h2>
              <p style={{ margin:'0 0 20px', fontSize:14, color:'rgba(255,255,255,.75)', lineHeight:1.55, maxWidth:440 }}>
                Create your first project and bring your ideas to life. Collaborate, record, and make music together.
              </p>
              <Button variant="brand" size="lg" onClick={() => openModal('new-project', {})}>
                <Plus/>
                Create your first project
              </Button>
            </div>
          </motion.section>
        )}

        {/* ── Below the fold: projects grid + rail ── */}
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) 330px',
          gap:20, alignItems:'start', marginTop:24 }}>

          {/* Projects grid — doubles as the Archive (the standalone Projects/
              Library pages were retired; this is the one projects surface). */}
          <motion.section {...rise(0.1)} aria-label={showArchive ? 'Archived projects' : 'Your projects'}>
            <SectionHeader
              eyebrow={showArchive ? 'Archive' : 'Library'}
              title={showArchive ? 'Archived Projects' : 'Your Projects'}
              style={{ marginBottom:14 }}
              action={(archivedProjects.length > 0 || showArchive) && (
                <Button variant="secondary" size="sm" className="rounded-full"
                  onClick={() => setShowArchive(v => !v)} aria-pressed={showArchive}
                  style={showArchive ? { background:'var(--brand-tint)', color:'var(--brand)' } : { color:'var(--t3)' }}>
                  <Archive/>
                  {showArchive ? 'Back to projects' : 'Archive'}
                  {!showArchive && (
                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 text-[color:var(--t4)]">
                      {archivedProjects.length}
                    </Badge>
                  )}
                </Button>
              )}/>
            {projList.length ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:14 }}>
                {projList.map(p => (
                  <div key={p.id} style={showArchive ? { opacity:.75 } : undefined}>
                    <ProjectCard project={p}
                      active={p.id === selId}
                      fav={favs.has(p.id)} onToggleFav={toggleFav}
                      onSelect={proj => setSelId(proj.id)}
                      onOpen={proj => navigate(`/projects/${proj.id}`)}/>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center',
                padding:'30px 20px', background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:'var(--r-3)' }}>
                {!showArchive && <img src={ufoImg} alt="" style={{ width:'100%', maxWidth:340, borderRadius:'var(--r-2)', display:'block', marginBottom:18 }}/>}
                <div style={{ fontSize:17, fontWeight:600, color:'var(--t1)', letterSpacing:'-.4px', marginBottom:6, paddingTop: showArchive ? 10 : 0 }}>
                  {q ? 'Nothing matches your search' : showArchive ? 'Nothing in the archive' : 'No projects in sight'}
                </div>
                <div style={{ fontSize:13, color:'var(--t3)', lineHeight:1.6, paddingBottom: showArchive ? 10 : 0 }}>
                  {q ? 'Try a different name.' : showArchive ? 'Archived projects will show up here.' : 'Create a project to see it here.'}
                </div>
              </div>
            )}
          </motion.section>

          {/* Rail */}
          <motion.aside {...rise(0.15)} aria-label="Project details"
            style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-3)',
              boxShadow:'var(--shadow-1)', display:'flex', flexDirection:'column', overflow:'hidden',
              maxHeight: isMobile ? 'none' : 'calc(100vh - 140px)', position: isMobile ? 'static' : 'sticky', top:0 }}>
            {/* Search — shadcn Input with icon adornments */}
            <div style={{ padding:'12px 12px 0', position:'relative' }}>
              <Search size={14} style={{ position:'absolute', left:24, top:'50%', marginTop:6, transform:'translateY(-50%)', color:'var(--t3)', pointerEvents:'none' }}/>
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, stems"
                className="h-9 pl-9 pr-8 text-[12.5px] bg-[color:var(--surface-2)] border-transparent"/>
              {search && (
                <Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setSearch('')}
                  style={{ position:'absolute', right:20, top:'50%', marginTop:6, transform:'translateY(-50%)', color:'var(--t3)' }}>
                  <X/>
                </Button>
              )}
            </div>

            {/* Tabs — shadcn (radix) line variant, controlled by the same state */}
            <Tabs value={tab} onValueChange={setTab} style={{ padding:'10px 12px 0', borderBottom:'1px solid var(--border)' }}>
              <TabsList variant="line" className="w-full justify-start gap-4">
                {TABS.map(([id, label]) => (
                  <TabsTrigger key={id} value={id}
                    className="flex-none px-0 text-[12.5px] data-[state=active]:after:bg-[color:var(--brand)]">
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {railList}
          </motion.aside>
        </div>
      </div>
    </MotionConfig>
  )
}
