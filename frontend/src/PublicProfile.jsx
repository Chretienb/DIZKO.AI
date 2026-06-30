import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi, showcaseApi, messagesApi } from './lib/api'
import { getToken } from './lib/utils.js'
import { DEMO_PROFILES, getDemoProfile, demoToProfile } from './lib/demoProfiles.js'
import ShowcaseTrack from './components/ShowcaseTrack.jsx'

const C = { coral:'#E95A51', grad:'linear-gradient(135deg,#f4937a,#f28fb8)' }
const BASE = '/api'

// Public producer profile — the social showcase. No app shell, no login to view.
// Logged-out visitors can browse + stream previews; following, liking, and
// HQ downloads require an account (we stash intent and route to /login).
export default function PublicProfile() {
  const { handle } = useParams()
  const navigate = useNavigate()
  const [state, setState]   = useState('loading')   // loading | notfound | ready
  const [p, setP]           = useState(null)
  const [items, setItems]   = useState([])
  const [following, setFollowing] = useState(false)
  const [myHandle, setMyHandle]   = useState(null)   // logged-in viewer's own handle → "My profile"
  const [myAvatar, setMyAvatar]   = useState(null)
  const [dm, setDm]               = useState(null)   // { kind:'message'|'collab' } — open DM thread
  const [thread, setThread]       = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [dmText, setDmText]       = useState('')
  const [sending, setSending]     = useState(false)
  const [toast, setToast]         = useState(null)
  const [searchQ, setSearchQ]     = useState('')
  const [results, setResults]     = useState(null)   // null = not searching
  const myId = useMemo(() => { try { return JSON.parse(atob(getToken().split('.')[1])).sub } catch { return null } }, [])
  const threadEndRef = useRef(null)

  const isDemo = !!p?.demo

  // Logged-in viewer's own handle/avatar, for the "My profile" avatar shortcut.
  useEffect(() => {
    if (!getToken()) return
    showcaseApi.me().then(r => { const pr = r?.data?.profile || {}; setMyHandle(pr.handle || null); setMyAvatar(pr.avatar_url || null) }).catch(() => {})
  }, [])

  const flashToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread, dm])

  // Deep-link to a specific track (?t=<itemId>) — scroll it into view.
  useEffect(() => {
    if (state !== 'ready') return
    const t = new URLSearchParams(window.location.search).get('t')
    if (t) setTimeout(() => document.getElementById(`track-${t}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350)
  }, [state])

  // Share — native share sheet where available, otherwise copy the link.
  const share = async (path, label) => {
    const url = `${window.location.origin}${path}`
    if (navigator.share) {
      try { await navigator.share({ title: 'Dizko', text: label, url }); return } catch { return }  // cancelled
    }
    try { await navigator.clipboard.writeText(url); flashToast('Link copied ✓') }
    catch { flashToast(url) }
  }
  const shareProfile = () => share(`/u/${p.handle}`, `${p.display_name} on Dizko`)
  const shareTrack   = (item) => share(`/u/${p.handle}?t=${item.id}`, `${item.title} — ${p.display_name}`)

  // Debounced producer search (real public profiles + matching demos).
  useEffect(() => {
    const q = searchQ.trim()
    if (!q) { setResults(null); return }
    const t = setTimeout(() => {
      publicApi.searchProfiles(q).then(r => {
        const real = r?.data || []
        const seen = new Set(real.map(x => x.handle))
        const ql = q.toLowerCase()
        const demos = DEMO_PROFILES
          .filter(d => !seen.has(d.handle) && (d.display_name.toLowerCase().includes(ql) || d.handle.includes(ql)))
          .map(d => ({ handle: d.handle, display_name: d.display_name, avatar_url: d.avatar_url, follower_count: d.follower_count, trackCount: d.items.length }))
        setResults([...real, ...demos])
      }).catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ])

  useEffect(() => {
    // Seeded demo producers render client-side (no DB) so the network feels alive.
    const demo = getDemoProfile(handle)
    if (demo) {
      const d = demoToProfile(demo)
      setP(d); setItems(d.items); setFollowing(false); setState('ready')
      document.title = `${d.display_name} (@${d.handle}) · Dizko`
      return
    }
    publicApi.profile(handle)
      .then(r => {
        if (r?.data) {
          setP(r.data); setItems(r.data.items || []); setFollowing(!!r.data.is_following)
          setState('ready')
          document.title = `${r.data.display_name} (@${r.data.handle}) · Dizko`
        } else setState('notfound')
      })
      .catch(() => setState('notfound'))
  }, [handle])

  // Anyone can look; doing anything needs an account.
  const requireAccount = (intent) => {
    if (getToken()) return true
    try { localStorage.setItem('dizko_profile_intent', JSON.stringify({ handle, ...intent })) } catch {}
    navigate('/login')
    return false
  }

  const toggleFollow = async () => {
    if (!requireAccount({ action: 'follow' })) return
    if (p.is_self) return
    const next = !following
    setFollowing(next)
    setP(prev => ({ ...prev, follower_count: Math.max(0, prev.follower_count + (next ? 1 : -1)) }))
    if (isDemo) return   // demo profiles: local UI only, no API
    try { next ? await showcaseApi.follow(p.id) : await showcaseApi.unfollow(p.id) }
    catch { setFollowing(!next) }   // revert on failure
  }

  const toggleLike = async (item) => {
    if (!requireAccount({ action: 'like', itemId: item.id })) return
    const next = !item.liked
    setItems(list => list.map(i => i.id === item.id
      ? { ...i, liked: next, like_count: Math.max(0, i.like_count + (next ? 1 : -1)) } : i))
    if (isDemo) return   // demo profiles: local UI only, no API
    try { next ? await showcaseApi.like(item.id) : await showcaseApi.unlike(item.id) }
    catch {
      setItems(list => list.map(i => i.id === item.id
        ? { ...i, liked: !next, like_count: Math.max(0, i.like_count + (next ? -1 : 1)) } : i))
    }
  }

  // Back to the app dashboard. The profile stays public (so fans/discovery keep
  // working); the dashboard toggle rests left on its own since it's a view switch.
  const backToApp = () => navigate('/')

  // Open an IG-style DM thread. Real producers: load the conversation (persists
  // to your inbox). Demo producers: a local simulated thread.
  const contact = (kind) => {
    if (!requireAccount({ action: kind })) return
    setDm({ kind })
    setDmText(kind === 'collab' ? `Hey ${p.display_name}, love your sound — want to collab on something? 🎶` : '')
    setThread([])
    if (!isDemo) {
      setThreadLoading(true)
      messagesApi.conversation(p.id).then(r => setThread(r?.data || [])).catch(() => {}).finally(() => setThreadLoading(false))
    }
  }

  const sendDM = async () => {
    const text = dmText.trim()
    if (!text || sending) return
    setSending(true)
    const mine = { id: `tmp-${Date.now()}`, from_user_id: myId, to_user_id: p.id, text, created_at: new Date().toISOString() }
    setThread(t => [...t, mine]); setDmText('')
    try {
      if (!isDemo) await messagesApi.send(p.id, text)
      else setTimeout(() => setThread(t => [...t, { id: `r-${Date.now()}`, from_user_id: p.id, to_user_id: myId, text: `thanks for reaching out! 🙏 (demo reply)`, created_at: new Date().toISOString() }]), 1100)
    } catch (e) { flashToast(e.message || 'Could not send'); setThread(t => t.filter(m => m.id !== mine.id)) }
    setSending(false)
  }

  const download = async (item) => {
    if (!requireAccount({ action: 'download', itemId: item.id })) return
    try {
      const r = await showcaseApi.downloadUrl(item.id)
      if (r?.data?.url) {
        const a = document.createElement('a')
        a.href = r.data.url; a.download = r.data.filename || ''; document.body.appendChild(a); a.click(); a.remove()
      }
    } catch (e) { alert(e.message || 'Download unavailable') }
  }

  const Shell = ({ children }) => (
    <div style={{ minHeight:'100vh', padding:'0 16px 60px',
      background:'radial-gradient(90% 40% at 50% 0%, rgba(244,147,122,.13), transparent 55%), #0b0b10',
      color:'#f1f1f3', fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif" }}>
      <div style={{ width:'100%', maxWidth:980, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 0 10px' }}>
          <a href="/" style={{ display:'flex', alignItems:'center', gap:9, textDecoration:'none' }}>
            <img src="/logo.png" alt="Dizko" style={{ width:30, height:30, borderRadius:9, objectFit:'cover' }} />
            <span style={{ fontWeight:800, fontSize:18, letterSpacing:'-.4px', color:'#f1f1f3' }}>dizko</span>
          </a>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            {getToken() && <button onClick={backToApp} style={navLink}>← Back to app</button>}
            {getToken() && myHandle && (
              <button onClick={() => { navigate(`/u/${myHandle}`); window.scrollTo(0,0) }} title="Go to my profile"
                className="pp-me" style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 5px 4px 13px', borderRadius:100, cursor:'pointer',
                  background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.12)', fontFamily:'inherit' }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#f1f1f3' }}>My profile</span>
                <div style={{ width:30, height:30, borderRadius:'50%', overflow:'hidden', flexShrink:0,
                  background: myAvatar ? `center/cover url(${myAvatar})` : C.grad, border:'1.5px solid rgba(255,255,255,.25)' }} />
              </button>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  )

  if (state === 'loading')  return <Shell><div style={{ textAlign:'center', color:'rgba(255,255,255,.5)', fontSize:14, paddingTop:60 }}>Loading…</div></Shell>
  if (state === 'notfound') return (
    <Shell>
      <div style={{ textAlign:'center', paddingTop:50 }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>Profile not found</div>
        <div style={{ fontSize:13.5, color:'rgba(255,255,255,.5)', marginBottom:22 }}>This producer may be private or the handle doesn’t exist.</div>
        <a href="/" style={{ color:C.coral, fontWeight:600, textDecoration:'none', fontSize:14 }}>Go to Dizko →</a>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <style>{`
        .pp-grid { display:grid; grid-template-columns:1fr; gap:18px; align-items:start; }
        @media (min-width: 860px) {
          .pp-grid { grid-template-columns: 340px 1fr; gap:40px; }
          .pp-left { position:sticky; top:16px; }
        }
        .pp-me > div { transition:border-color .15s; }
        .pp-me:hover > div { border-color:#fff; }
      `}</style>
      <div className="pp-grid">
      <div className="pp-left">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:18, padding:'14px 4px 18px' }}>
        <div style={{ width:88, height:88, borderRadius:'50%', flexShrink:0, overflow:'hidden',
          border:'2px solid rgba(255,255,255,.12)', boxShadow:'0 10px 30px rgba(0,0,0,.5)',
          background: p.avatar_url ? `center/cover url(${p.avatar_url})` : C.grad }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', gap:26, marginBottom:8 }}>
            <Stat n={items.length} label="tracks" />
            <Stat n={p.follower_count} label="followers" />
            <Stat n={p.following_count} label="following" />
          </div>
          {p.is_self ? (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={() => navigate('/library?profile=1')} style={{ ...btn(C.grad, '#fff'), display:'inline-flex', alignItems:'center', gap:6 }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Add tracks
              </button>
              <button onClick={() => navigate('/library?profile=1')} style={{ ...btn('rgba(255,255,255,.08)', '#fff'), display:'inline-flex', alignItems:'center', gap:6 }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                Edit
              </button>
              <button onClick={shareProfile} title="Share profile" style={{ ...btn('rgba(255,255,255,.08)', '#fff'), display:'inline-flex', alignItems:'center', gap:6 }}>{shareIcon} Share</button>
            </div>
          ) : (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={toggleFollow} style={btn(following ? 'rgba(255,255,255,.1)' : C.grad, '#fff')}>
                {following ? 'Following' : 'Follow'}
              </button>
              <button onClick={() => contact('message')} style={btn('rgba(255,255,255,.1)', '#fff')}>Message</button>
              <button onClick={() => contact('collab')} style={btn('rgba(255,255,255,.1)', '#fff')}>Collab</button>
              <button onClick={shareProfile} title="Share profile" style={{ ...btn('rgba(255,255,255,.1)', '#fff'), display:'inline-flex', alignItems:'center', gap:6 }}>{shareIcon} Share</button>
            </div>
          )}
        </div>
      </div>

      {/* Identity */}
      <div style={{ padding:'0 4px 22px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize:16, fontWeight:800 }}>{p.display_name}</div>
          {isDemo && <span style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.06em', padding:'2px 7px', borderRadius:6, background:'rgba(244,147,122,.18)', color:C.coral }}>DEMO</span>}
        </div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,.45)', marginBottom:p.bio?8:0 }}>@{p.handle}</div>
        {p.bio && <div style={{ fontSize:13.5, lineHeight:1.5, color:'rgba(255,255,255,.78)', whiteSpace:'pre-wrap' }}>{p.bio}</div>}
        {Array.isArray(p.links) && p.links.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginTop:10 }}>
            {p.links.map((l, i) => (
              <a key={i} href={/^https?:\/\//.test(l) ? l : `https://${l}`} target="_blank" rel="noreferrer"
                style={{ fontSize:12.5, color:C.coral, textDecoration:'none', fontWeight:600 }}>{l.replace(/^https?:\/\//, '')} ↗</a>
            ))}
          </div>
        )}
      </div>
      </div>{/* /pp-left */}

      <div className="pp-right">
      {/* Showcase */}
      {items.length === 0 ? (
        <div style={{ textAlign:'center', padding:'46px 24px', borderRadius:16, border:'1px dashed rgba(255,255,255,.12)' }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>{p.is_self ? 'Showcase your first track' : 'No tracks showcased yet.'}</div>
          {p.is_self && (
            <>
              <div style={{ fontSize:12.5, color:'rgba(255,255,255,.45)', marginBottom:16 }}>Pick your best sounds from your library to show the world.</div>
              <button onClick={() => navigate('/library?profile=1')} style={{ ...btn(C.grad, '#fff'), padding:'10px 22px' }}>+ Add from your library</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {items.map(item => (
            <div id={`track-${item.id}`} key={item.id}>
              <ShowcaseTrack item={item} isDemo={isDemo} ownerIsSelf={!!p.is_self}
                requireAccount={requireAccount} onLike={toggleLike} onDownload={download} onShare={shareTrack} />
            </div>
          ))}
        </div>
      )}

      {!getToken() && (
        <div style={{ textAlign:'center', marginTop:28, padding:'18px', borderRadius:14, background:'rgba(244,147,122,.08)', border:'1px solid rgba(244,147,122,.18)' }}>
          <div style={{ fontSize:13.5, color:'rgba(255,255,255,.8)', marginBottom:12 }}>Like, follow, and download <b>{p.display_name}</b>’s work on Dizko.</div>
          <button onClick={() => navigate('/login')} style={{ ...btn(C.grad, '#fff'), padding:'10px 22px' }}>Create a free account</button>
        </div>
      )}
      </div>{/* /pp-right */}
      </div>{/* /pp-grid */}

      {/* Discover other producers — modern card grid */}
      <style>{`
        .pp-discover { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
        @media (min-width: 720px)  { .pp-discover { grid-template-columns:repeat(3,1fr); } }
        @media (min-width: 1000px) { .pp-discover { grid-template-columns:repeat(4,1fr); } }
        .pp-pcard { transition:transform .12s ease, border-color .12s ease, background .12s ease; }
        .pp-pcard:hover { transform:translateY(-3px); border-color:rgba(244,147,122,.4)!important; background:rgba(255,255,255,.06)!important; }
      `}</style>
      <div style={{ marginTop:44 }}>
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.2px', color:'#f1f1f3', marginBottom:4 }}>Discover producers</div>
        <div style={{ fontSize:12.5, color:'rgba(255,255,255,.45)', marginBottom:16 }}>Search by name or @handle — find your next collaborator.</div>

        {/* Search */}
        <div style={{ position:'relative', marginBottom:18, maxWidth:440 }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth={2} strokeLinecap="round"
            style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search producers…"
            style={{ width:'100%', padding:'11px 14px 11px 40px', borderRadius:100, border:'1px solid rgba(255,255,255,.14)', background:'rgba(255,255,255,.05)', color:'#fff', fontSize:13.5, fontFamily:'inherit', boxSizing:'border-box' }} />
          {searchQ && <button onClick={() => setSearchQ('')} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.4)', fontSize:15 }}>✕</button>}
        </div>

        {(() => {
          const searching = searchQ.trim().length > 0
          const list = searching ? (results || []) : DEMO_PROFILES.filter(d => d.handle !== p.handle)
          if (searching && results === null) return <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', padding:'8px 2px' }}>Searching…</div>
          if (list.length === 0) return <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', padding:'8px 2px' }}>No producers found for “{searchQ}”.</div>
          return (
            <div className="pp-discover">
              {list.map(d => {
                const tracks = d.items?.length ?? d.trackCount
                return (
                  <button key={d.handle} className="pp-pcard" onClick={() => { navigate(`/u/${d.handle}`); window.scrollTo(0, 0); setSearchQ('') }}
                    style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:4, padding:'20px 14px', borderRadius:16, cursor:'pointer',
                      background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)', fontFamily:'inherit', color:'#f1f1f3' }}>
                    <div style={{ width:68, height:68, borderRadius:'50%', marginBottom:8, background: d.avatar_url ? `center/cover url(${d.avatar_url})` : C.grad, border:'2px solid rgba(255,255,255,.12)' }} />
                    <div style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%' }}>{d.display_name}</div>
                    <div style={{ fontSize:11.5, color:'rgba(255,255,255,.4)' }}>@{d.handle}</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,.55)', marginTop:6 }}>{fmt(d.follower_count)} followers{tracks != null ? ` · ${tracks} tracks` : ''}</div>
                    <span style={{ marginTop:12, fontSize:11.5, fontWeight:700, color:C.coral, padding:'5px 16px', borderRadius:100, border:`1px solid ${C.coral}55` }}>View</span>
                  </button>
                )
              })}
            </div>
          )
        })()}
      </div>

      {/* DM thread (IG-style) — persists to your inbox for real producers */}
      {dm && (
        <div onClick={() => setDm(null)}
          style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center', padding:'0', }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:'100%', maxWidth:440, height:'min(80vh, 560px)', background:'#14141a', border:'1px solid rgba(255,255,255,.1)',
              borderRadius:'20px 20px 0 0', display:'flex', flexDirection:'column', overflow:'hidden', marginBottom:0 }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.08)' }}>
              <div style={{ width:38, height:38, borderRadius:'50%', flexShrink:0, background: p.avatar_url ? `center/cover url(${p.avatar_url})` : C.grad }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>{p.display_name}</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.45)' }}>@{p.handle}</div>
              </div>
              <button onClick={() => setDm(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.5)', fontSize:20 }}>✕</button>
            </div>

            {/* Thread */}
            <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:8 }}>
              {threadLoading ? <div style={{ color:'rgba(255,255,255,.4)', fontSize:13, textAlign:'center', marginTop:20 }}>Loading…</div> :
               thread.length === 0 ? (
                <div style={{ textAlign:'center', color:'rgba(255,255,255,.4)', fontSize:12.5, marginTop:'auto', marginBottom:'auto' }}>
                  {dm.kind === 'collab' ? 'Pitch your collab idea' : `Say hi to ${p.display_name}`}
                </div>
              ) : thread.map(m => {
                const mine = m.from_user_id === myId
                return (
                  <div key={m.id} style={{ display:'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth:'76%', padding:'9px 13px', borderRadius:16, fontSize:13.5, lineHeight:1.4, wordBreak:'break-word',
                      background: mine ? C.coral : 'rgba(255,255,255,.08)', color:'#fff',
                      borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4 }}>{m.text}</div>
                  </div>
                )
              })}
              <div ref={threadEndRef} />
            </div>

            {/* Composer */}
            <div style={{ display:'flex', gap:8, padding:'12px 14px', borderTop:'1px solid rgba(255,255,255,.08)' }}>
              <input autoFocus value={dmText} onChange={e => setDmText(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendDM()}
                placeholder="Message…"
                style={{ flex:1, minWidth:0, padding:'10px 14px', borderRadius:100, border:'1px solid rgba(255,255,255,.14)', background:'rgba(255,255,255,.05)', color:'#fff', fontSize:13.5, fontFamily:'inherit' }} />
              <button onClick={sendDM} disabled={!dmText.trim() || sending}
                style={{ flexShrink:0, width:42, height:42, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:16, opacity:(!dmText.trim()||sending)?.5:1 }}>➤</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:26, left:'50%', transform:'translateX(-50%)', zIndex:1001,
          padding:'11px 22px', borderRadius:100, background:'#fff', color:'#111', fontSize:13, fontWeight:700, boxShadow:'0 10px 30px rgba(0,0,0,.35)' }}>{toast}</div>
      )}
    </Shell>
  )
}

function Stat({ n, label }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:15, fontWeight:800 }}>{fmt(n)}</div>
      <div style={{ fontSize:11.5, color:'rgba(255,255,255,.45)' }}>{label}</div>
    </div>
  )
}

const btn = (bg, color) => ({
  padding:'7px 20px', borderRadius:10, border:'none', cursor:'pointer',
  background:bg, color, fontSize:13.5, fontWeight:700, fontFamily:'inherit',
})

const navLink = { background:'none', border:'none', cursor:'pointer', fontSize:12.5, color:'rgba(255,255,255,.6)', fontWeight:600, fontFamily:'inherit' }

const shareIcon = (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
  </svg>
)

function fmt(n) {
  n = Number(n) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
