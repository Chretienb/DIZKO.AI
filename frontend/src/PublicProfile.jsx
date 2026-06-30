import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi, showcaseApi, messagesApi } from './lib/api'
import { getToken } from './lib/utils.js'
import { DEMO_PROFILES, getDemoProfile, demoToProfile } from './lib/demoProfiles.js'
import ShowcaseTrack from './components/ShowcaseTrack.jsx'
import ShareCard from './components/ShareCard.jsx'

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
  const [toast, setToast]         = useState(null)
  const [authPrompt, setAuthPrompt] = useState(null) // { action } — smooth sign-up nudge
  const [shareCard, setShareCard]   = useState(null) // { kind:'profile'|'track', item }
  const [tab, setTab]               = useState('tracks') // tracks | reposts
  const [reposts, setReposts]       = useState(null)
  const [repostsLoading, setRepostsLoading] = useState(false)
  const myId = useMemo(() => { try { return JSON.parse(atob(getToken().split('.')[1])).sub } catch { return null } }, [])

  const isDemo = !!p?.demo

  // Logged-in viewer's own handle/avatar, for the "My profile" avatar shortcut.
  useEffect(() => {
    if (!getToken()) return
    showcaseApi.me().then(r => { const pr = r?.data?.profile || {}; setMyHandle(pr.handle || null); setMyAvatar(pr.avatar_url || null) }).catch(() => {})
  }, [])

  const flashToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2600) }

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
  const shareProfile = () => setShareCard({ kind: 'profile' })
  const shareTrack   = (item) => setShareCard({ kind: 'track', item })

  useEffect(() => {
    setTab('tracks'); setReposts(null)   // reset when switching profiles
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

  // Anyone can look; doing anything needs an account. Instead of a hard redirect,
  // we open a calm in-context prompt (remembering what they were trying to do).
  const requireAccount = (intent) => {
    if (getToken()) return true
    try { localStorage.setItem('dizko_profile_intent', JSON.stringify({ handle, ...intent })) } catch {}
    setAuthPrompt(intent || { action: 'continue' })
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

  // Repost — shares someone's track to your followers; original stays credited.
  const toggleRepost = async (item) => {
    if (!requireAccount({ action: 'repost', itemId: item.id })) return
    const next = !item.reposted
    const apply = (delta) => (list) => list && list.map(i => i.id === item.id
      ? { ...i, reposted: next, repost_count: Math.max(0, (i.repost_count || 0) + delta) } : i)
    setItems(apply(next ? 1 : -1)); setReposts(apply(next ? 1 : -1))
    if (isDemo) return
    try { next ? await showcaseApi.repost(item.id) : await showcaseApi.unrepost(item.id) }
    catch {
      const rev = (list) => list && list.map(i => i.id === item.id
        ? { ...i, reposted: !next, repost_count: Math.max(0, (i.repost_count || 0) + (next ? -1 : 1)) } : i)
      setItems(rev); setReposts(rev)
    }
  }

  // Lazy-load the Reposts tab the first time it's opened.
  useEffect(() => {
    if (tab !== 'reposts' || reposts !== null) return
    if (isDemo) { setReposts([]); return }
    setRepostsLoading(true)
    publicApi.reposts(handle).then(r => setReposts(r?.data || [])).catch(() => setReposts([])).finally(() => setRepostsLoading(false))
  }, [tab, reposts, isDemo, handle])

  // Back to the app dashboard. The profile stays public (so fans/discovery keep
  // working); the dashboard toggle rests left on its own since it's a view switch.
  const backToApp = () => navigate('/')

  // Open an IG-style DM thread. Real producers: load the conversation (persists
  // to your inbox). Demo producers: a local simulated thread.
  // Owner can pull a track off their public profile right here.
  const removeShowcaseItem = async (item) => {
    if (!window.confirm(`Remove “${item.title}” from your profile? (The file stays in your library.)`)) return
    setItems(list => list.filter(i => i.id !== item.id))
    if (isDemo) return
    try { await showcaseApi.removeItem(item.id) } catch {}
  }

  // Opens the DM thread (the thread itself is an isolated component so typing
  // never re-renders the whole profile).
  const contact = (kind) => {
    if (!requireAccount({ action: kind })) return
    setDm({ kind })
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
    <div style={{ minHeight:'100vh', padding:'0 16px 60px', overflowX:'hidden', boxSizing:'border-box',
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
        .pp-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:18px; align-items:start; }
        .pp-left, .pp-right { min-width:0; }
        @media (min-width: 860px) {
          .pp-grid { grid-template-columns: 340px minmax(0,1fr); gap:40px; }
          .pp-left { position:sticky; top:16px; }
        }
        .pp-me > div { transition:border-color .15s; }
        .pp-me:hover > div { border-color:#fff; }
        @keyframes ppSpin { to { transform: rotate(360deg); } }
        .pp-disc { animation: ppSpin 20s linear infinite; }
        /* Decorative record is a desktop nicety — hide it on phones so the
           tracks aren't pushed down. */
        @media (max-width: 859px) { .pp-deco { display:none; } }
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
              <button onClick={() => navigate('/library?profile=1')} style={{ ...ghostBtn, border:'none', background:'rgba(255,255,255,.08)' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Add tracks
              </button>
              <button onClick={shareProfile} title="Share profile" style={{ ...ghostBtn, border:'none', background:'rgba(255,255,255,.08)' }}>{shareIcon} Share</button>
            </div>
          ) : (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={toggleFollow}
                style={following ? ghostBtn : { ...ghostBtn, background:'rgba(233,90,81,.16)', border:'1px solid rgba(233,90,81,.4)', color:'#fff' }}>
                {following ? 'Following' : 'Follow'}
              </button>
              <button onClick={() => contact('message')} style={ghostBtn}>Message</button>
              <button onClick={() => contact('collab')} style={ghostBtn}>Collab</button>
              <button onClick={shareProfile} title="Share profile" style={ghostBtn}>{shareIcon} Share</button>
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

      {/* Decorative spinning record (desktop only) */}
      <div className="pp-deco" style={{ display:'flex', justifyContent:'center', padding:'10px 0 6px' }}>
        <img src="/share/vinyl-33.png" alt="" className="pp-disc"
          style={{ width:'74%', maxWidth:230, aspectRatio:'1', objectFit:'cover', borderRadius:'50%', boxShadow:'0 14px 44px rgba(0,0,0,.55)' }} />
      </div>
      </div>{/* /pp-left */}

      <div className="pp-right">
      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid rgba(255,255,255,.08)' }}>
        {[['tracks', `Tracks${items.length ? ` · ${items.length}` : ''}`], ['reposts', 'Reposts']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:700, padding:'8px 12px',
              color: tab === k ? '#fff' : 'rgba(255,255,255,.45)', borderBottom: tab === k ? `2px solid ${C.coral}` : '2px solid transparent', marginBottom:-1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tracks' ? (
        items.length === 0 ? (
          <div style={{ borderRadius:18, overflow:'hidden', border:'1px solid rgba(255,255,255,.08)', background:'#0e0e12' }}>
            <img src="/share/eras.png" alt="" style={{ width:'100%', display:'block' }} />
            <div style={{ padding:'22px 24px 28px', textAlign:'center' }}>
              <div style={{ fontSize:16, fontWeight:800, marginBottom:6 }}>{p.is_self ? 'Showcase your first track' : 'No tracks showcased yet.'}</div>
              {p.is_self && (
                <>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,.55)', marginBottom:18 }}>Pick your best sounds from your library to show the world.</div>
                  <button onClick={() => navigate('/library?profile=1')}
                    style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', background:'rgba(255,255,255,.12)', color:'#fff', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
                    + Add from your library
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {items.map(item => (
              <div id={`track-${item.id}`} key={item.id}>
                <ShowcaseTrack item={item} isDemo={isDemo} ownerIsSelf={!!p.is_self}
                  requireAccount={requireAccount} onLike={toggleLike} onDownload={download} onShare={shareTrack}
                  onRepost={p.is_self ? null : toggleRepost}
                  onRemove={p.is_self ? removeShowcaseItem : null} />
              </div>
            ))}
          </div>
        )
      ) : (
        repostsLoading || reposts === null ? <div style={{ color:'rgba(255,255,255,.4)', fontSize:13, padding:'30px 0', textAlign:'center' }}>Loading…</div> :
        reposts.length === 0 ? (
          <div style={{ textAlign:'center', padding:'46px 24px', borderRadius:16, border:'1px dashed rgba(255,255,255,.12)', color:'rgba(255,255,255,.5)', fontSize:13 }}>
            {p.is_self ? 'Tracks you repost will show here. Repost beats you love to share them with your followers.' : `${p.display_name} hasn’t reposted anything yet.`}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {reposts.map(item => (
              <ShowcaseTrack key={item.id} item={item} isDemo={isDemo} ownerIsSelf={false}
                requireAccount={requireAccount} onLike={toggleLike} onDownload={download} onShare={shareTrack}
                onRepost={toggleRepost} originalOwner={item.owner} onOpenOwner={h => { navigate(`/u/${h}`); window.scrollTo(0, 0) }} />
            ))}
          </div>
        )
      )}

      {!getToken() && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap',
          marginTop:24, padding:'16px 18px', borderRadius:14, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)' }}>
          <div style={{ fontSize:13, color:'rgba(255,255,255,.7)', lineHeight:1.5 }}>
            Like, follow & download <span style={{ color:'#fff', fontWeight:600 }}>{p.display_name}</span>’s work.
          </div>
          <button onClick={() => navigate('/login?join=1')}
            style={{ flexShrink:0, padding:'8px 18px', borderRadius:10, border:'none', cursor:'pointer', background:'#fff', color:'#111', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            Join Dizko
          </button>
        </div>
      )}
      </div>{/* /pp-right */}
      </div>{/* /pp-grid */}

      <DiscoverProducers currentHandle={p.handle} navigate={navigate} />

      {dm && <DmThread profile={p} kind={dm.kind} isDemo={isDemo} myId={myId} onClose={() => setDm(null)} onError={flashToast} />}

      {shareCard && (
        <ShareCard kind={shareCard.kind} item={shareCard.item}
          profile={{ handle: p.handle, display_name: p.display_name, avatar_url: p.avatar_url }}
          onClose={() => setShareCard(null)} />
      )}

      {/* Smooth sign-up nudge — calm, contextual, not a hard redirect */}
      {authPrompt && (() => {
        const COPY = {
          follow:   { t:`Follow ${p.display_name}`,        s:'Get their new drops in your feed and never miss a beat.' },
          like:     { t:'Like this track',                 s:`Save the beats you love and show ${p.display_name} support.` },
          download: { t:'Download this track',             s:`Grab ${p.display_name}’s work in full quality, free.` },
          comment:  { t:'Join the conversation',           s:'Leave a comment and connect with the producer.' },
          message:  { t:`Message ${p.display_name}`,       s:'DM producers and line up your next collab.' },
          collab:   { t:`Collab with ${p.display_name}`,   s:'Invite producers to work on something together.' },
          repost:   { t:'Repost this track',               s:'Share it with your followers — the original stays credited.' },
        }
        const c = COPY[authPrompt.action] || { t:'Join Dizko', s:'Create a free account to like, follow, comment and download.' }
        return (
          <div onClick={() => setAuthPrompt(null)}
            style={{ position:'fixed', inset:0, zIndex:1002, background:'rgba(0,0,0,.6)', backdropFilter:'blur(6px)',
              display:'flex', alignItems:'center', justifyContent:'center', padding:20, animation:'ppFade .18s ease' }}>
            <style>{`@keyframes ppFade{from{opacity:0}to{opacity:1}} @keyframes ppRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            <div onClick={e => e.stopPropagation()}
              style={{ width:'100%', maxWidth:360, background:'#15151b', border:'1px solid rgba(255,255,255,.1)', borderRadius:20,
                padding:'26px 24px', textAlign:'center', animation:'ppRise .22s cubic-bezier(.2,.7,.2,1)' }}>
              <div style={{ width:60, height:60, borderRadius:'50%', margin:'0 auto 16px', background: p.avatar_url ? `center/cover url(${p.avatar_url})` : C.grad, border:'2px solid rgba(255,255,255,.12)' }} />
              <div style={{ fontSize:17, fontWeight:800, marginBottom:7, letterSpacing:'-.2px' }}>{c.t}</div>
              <div style={{ fontSize:13, color:'rgba(255,255,255,.6)', lineHeight:1.5, marginBottom:22 }}>{c.s}</div>
              <button onClick={() => navigate('/login?join=1')}
                style={{ width:'100%', padding:'12px', borderRadius:12, border:'none', cursor:'pointer', background:'#fff', color:'#111', fontSize:14, fontWeight:700, fontFamily:'inherit', marginBottom:10 }}>
                Create a free account
              </button>
              <button onClick={() => navigate('/login')}
                style={{ width:'100%', padding:'11px', borderRadius:12, border:'none', cursor:'pointer', background:'transparent', color:'rgba(255,255,255,.7)', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
                I already have an account
              </button>
              <button onClick={() => setAuthPrompt(null)}
                style={{ marginTop:6, background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.4)', fontSize:12.5, fontFamily:'inherit' }}>
                Maybe later
              </button>
            </div>
          </div>
        )
      })()}

      {toast && (
        <div style={{ position:'fixed', bottom:26, left:'50%', transform:'translateX(-50%)', zIndex:1001,
          padding:'11px 22px', borderRadius:100, background:'#fff', color:'#111', fontSize:13, fontWeight:700, boxShadow:'0 10px 30px rgba(0,0,0,.35)' }}>{toast}</div>
      )}
    </Shell>
  )
}

// Isolated DM thread — its own text/thread state so typing never re-renders
// the whole profile (which caused the glitch/lag while messaging).
function DmThread({ profile, kind, isDemo, myId, onClose, onError }) {
  const [thread, setThread]   = useState([])
  const [loading, setLoading] = useState(!isDemo)
  const [text, setText]       = useState(kind === 'collab' ? `Hey ${profile.display_name}, love your sound — want to collab on something? 🎶` : '')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    if (isDemo) return
    messagesApi.conversation(profile.id).then(r => setThread(r?.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    const mine = { id: `tmp-${Date.now()}`, from_user_id: myId, to_user_id: profile.id, text: t, created_at: new Date().toISOString() }
    setThread(list => [...list, mine]); setText('')
    try {
      if (!isDemo) { const r = await messagesApi.send(profile.id, t); if (r?.data) setThread(list => list.map(m => m.id === mine.id ? r.data : m)) }
      else setTimeout(() => setThread(list => [...list, { id: `r-${Date.now()}`, from_user_id: profile.id, to_user_id: myId, text: 'thanks for reaching out! 🙏 (demo reply)', created_at: new Date().toISOString() }]), 1100)
    } catch (e) { onError?.(e.message || 'Could not send'); setThread(list => list.filter(m => m.id !== mine.id)) }
    setSending(false)
  }

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,.6)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', padding:18, animation:'ppFade .18s ease' }}>
      <style>{`@keyframes ppFade{from{opacity:0}to{opacity:1}}@keyframes ppRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div onClick={e => e.stopPropagation()}
        style={{ width:'100%', maxWidth:400, height:'min(78vh, 540px)', background:'#15151b', border:'1px solid rgba(255,255,255,.1)',
          borderRadius:20, display:'flex', flexDirection:'column', overflow:'hidden', animation:'ppRise .22s cubic-bezier(.2,.7,.2,1)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:11, padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', flexShrink:0, background: profile.avatar_url ? `center/cover url(${profile.avatar_url})` : C.grad }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, lineHeight:1.2 }}>{profile.display_name}</div>
            <div style={{ fontSize:11.5, color:'rgba(255,255,255,.45)' }}>@{profile.handle}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width:30, height:30, borderRadius:8, background:'rgba(255,255,255,.06)', border:'none', cursor:'pointer', color:'rgba(255,255,255,.6)', fontSize:15, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:8 }}>
          {loading ? <div style={{ color:'rgba(255,255,255,.4)', fontSize:13, textAlign:'center', marginTop:20 }}>Loading…</div> :
           thread.length === 0 ? (
            <div style={{ margin:'auto', textAlign:'center', padding:'0 10px' }}>
              <div style={{ width:56, height:56, borderRadius:'50%', margin:'0 auto 12px', background: profile.avatar_url ? `center/cover url(${profile.avatar_url})` : C.grad, border:'2px solid rgba(255,255,255,.1)' }} />
              <div style={{ fontSize:14.5, fontWeight:700, marginBottom:4 }}>{kind === 'collab' ? `Collab with ${profile.display_name}` : profile.display_name}</div>
              <div style={{ fontSize:12.5, color:'rgba(255,255,255,.5)', lineHeight:1.5 }}>{kind === 'collab' ? 'Pitch your idea and start something together.' : 'Start the conversation — say hi 👋'}</div>
            </div>
          ) : thread.map(m => {
            const mine = m.from_user_id === myId
            return (
              <div key={m.id} style={{ display:'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth:'76%', padding:'9px 14px', borderRadius:18, fontSize:13.5, lineHeight:1.4, wordBreak:'break-word',
                  background: mine ? C.coral : 'rgba(255,255,255,.09)', color:'#fff',
                  borderBottomRightRadius: mine ? 5 : 18, borderBottomLeftRadius: mine ? 18 : 5 }}>{m.text}</div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px', borderTop:'1px solid rgba(255,255,255,.07)' }}>
          <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Message…"
            style={{ flex:1, minWidth:0, padding:'11px 16px', borderRadius:100, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.05)', color:'#fff', fontSize:13.5, fontFamily:'inherit', outline:'none' }} />
          <button onClick={send} disabled={!text.trim() || sending} aria-label="Send"
            style={{ flexShrink:0, width:40, height:40, borderRadius:'50%', border:'none', cursor:'pointer', background: text.trim() ? C.coral : 'rgba(255,255,255,.12)', color:'#fff', fontSize:15, transition:'background .15s', opacity:sending?.6:1 }}>➤</button>
        </div>
      </div>
    </div>
  )
}

// Isolated so typing in the search box only re-renders this block — not the
// whole profile (which made each keystroke feel laggy / letter-by-letter).
function DiscoverProducers({ currentHandle, navigate }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => {
    const query = q.trim()
    if (!query) { setResults(null); return }
    const t = setTimeout(() => {
      publicApi.searchProfiles(query).then(r => {
        const real = r?.data || []
        const seen = new Set(real.map(x => x.handle))
        const ql = query.toLowerCase()
        const demos = DEMO_PROFILES
          .filter(d => !seen.has(d.handle) && (d.display_name.toLowerCase().includes(ql) || d.handle.includes(ql)))
          .map(d => ({ handle: d.handle, display_name: d.display_name, avatar_url: d.avatar_url, follower_count: d.follower_count, trackCount: d.items.length }))
        setResults([...real, ...demos])
      }).catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const searching = q.trim().length > 0
  const list = searching ? (results || []) : DEMO_PROFILES.filter(d => d.handle !== currentHandle)

  return (
    <>
      <style>{`
        .pp-discover { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; }
        .pp-discover::-webkit-scrollbar { height:6px; }
        .pp-discover::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:3px; }
        .pp-pcard { flex:0 0 148px; scroll-snap-align:start; transition:transform .12s ease, border-color .12s ease, background .12s ease; }
        .pp-pcard:hover { transform:translateY(-3px); border-color:rgba(244,147,122,.4)!important; background:rgba(255,255,255,.06)!important; }
      `}</style>
      <div style={{ marginTop:44 }}>
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.2px', color:'#f1f1f3', marginBottom:14 }}>Discover</div>

        <div style={{ position:'relative', marginBottom:18, maxWidth:380 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth={2} strokeLinecap="round"
            style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or @handle"
            style={{ width:'100%', padding:'9px 12px 9px 34px', borderRadius:10, border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.04)', color:'#fff', fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
        </div>

        {searching && results === null ? <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', padding:'8px 2px' }}>Searching…</div> :
         list.length === 0 ? <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', padding:'8px 2px' }}>No users found for “{q}”.</div> : (
          <div className="pp-discover">
            {list.map(d => {
              const tracks = d.items?.length ?? d.trackCount
              return (
                <button key={d.handle} className="pp-pcard" onClick={() => { navigate(`/u/${d.handle}`); window.scrollTo(0, 0) }}
                  style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:4, padding:'20px 14px', borderRadius:16, cursor:'pointer',
                    background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)', fontFamily:'inherit', color:'#f1f1f3' }}>
                  <div style={{ width:68, height:68, borderRadius:'50%', marginBottom:8, background: d.avatar_url ? `center/cover url(${d.avatar_url})` : C.grad, border:'2px solid rgba(255,255,255,.12)' }} />
                  <div style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%' }}>{d.display_name}</div>
                  <div style={{ fontSize:11.5, color:'rgba(255,255,255,.4)' }}>@{d.handle}</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,.55)', marginTop:6 }}>{fmt(d.follower_count)} followers{tracks != null ? ` · ${tracks} tracks` : ''}</div>
                  <span style={{ marginTop:12, fontSize:11.5, fontWeight:700, color:C.coral }}>View</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
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
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)

// Subtle, small action button used on your own profile (Add tracks / Share).
const ghostBtn = { padding:'6px 14px', borderRadius:9, border:'1px solid rgba(255,255,255,.18)', background:'transparent',
  color:'rgba(255,255,255,.85)', fontSize:12.5, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
  display:'inline-flex', alignItems:'center', gap:6 }

function fmt(n) {
  n = Number(n) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
