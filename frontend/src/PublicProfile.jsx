import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi, showcaseApi, messagesApi } from './lib/api'
import { getToken, timeAgo } from './lib/utils.js'
import { track } from './lib/posthog.js'
import { DEMO_PROFILES, getDemoProfile, demoToProfile, isDemoHandle } from './lib/demoProfiles.js'
import ShowcaseTrack from './components/ShowcaseTrack.jsx'
import ShareCard from './components/ShareCard.jsx'
import { Spinner, Btn, EmptyState } from './components/ui/index.jsx'
import { House, ChatCircle, UserCircle, MagnifyingGlass, Plus as PhPlus, ShareNetwork, FileText } from '@phosphor-icons/react'

const C = { coral:'#6D5AE6', grad:'linear-gradient(135deg,#7C6CF0,#A78BFA)' }
const BASE = '/api'

// Public producer profile — the social showcase. No app shell, no login to view.
// Logged-out visitors can browse + stream previews; following, liking, and
// HQ downloads require an account (we stash intent and route to /login).
export default function PublicProfile({ embedded = false }) {
  const { handle: paramHandle } = useParams()
  // Embedded (inside the studio app shell): show MY profile, resolved from my
  // own handle instead of a URL param — no second sidebar, app rail stays.
  const navigate = useNavigate()
  const [state, setState]   = useState('loading')   // loading | notfound | ready
  const [p, setP]           = useState(null)
  const [items, setItems]   = useState([])
  const [following, setFollowing] = useState(false)
  // Seed my handle/avatar synchronously from the cached /showcase/me snapshot so
  // "Back to my profile" resolves instantly instead of waiting on a round-trip.
  const _mc = showcaseApi.meCache?.()
  const [myHandle, setMyHandle]   = useState(_mc?.profile?.handle || null)   // logged-in viewer's own handle
  const [myAvatar, setMyAvatar]   = useState(_mc?.profile?.avatar_url || null)
  const [myHandleLoaded, setMyHandleLoaded] = useState(!!_mc)
  // A URL handle wins (viewing a specific profile); with none, embedded /profile
  // resolves to my own handle.
  const handle = paramHandle || myHandle
  const [dm, setDm]               = useState(null)   // { kind:'message'|'collab' } — open DM thread
  const [toast, setToast]         = useState(null)
  const [authPrompt, setAuthPrompt] = useState(null) // { action } — smooth sign-up nudge
  const [shareCard, setShareCard]   = useState(null) // { kind:'profile'|'track', item }
  const [tab, setTab]               = useState('tracks') // tracks | reposts
  const [reposts, setReposts]       = useState(null)
  const [repostsLoading, setRepostsLoading] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [spotifyExpanded, setSpotifyExpanded] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(() => { try { return localStorage.getItem('dizko_pubrail') === '0' } catch { return false } })
  const toggleRail = () => setRailCollapsed(v => { const n = !v; try { localStorage.setItem('dizko_pubrail', n ? '0' : '1') } catch {} ; return n })
  const myId = useMemo(() => { try { return JSON.parse(atob(getToken().split('.')[1])).sub } catch { return null } }, [])

  const isDemo = !!p?.demo

  // Logged-in viewer's own handle/avatar, for the "My profile" avatar shortcut.
  useEffect(() => {
    if (!getToken()) { setMyHandleLoaded(true); return }
    showcaseApi.me()
      .then(r => {
        const pr = r?.data?.profile || {}
        setMyHandle(pr.handle || null); setMyAvatar(pr.avatar_url || null)
        // Warm my own profile so "Back to my profile" paints instantly when I'm
        // currently looking at someone else's page.
        if (pr.handle && pr.handle !== handle) publicApi.prefetchProfile(pr.handle)
      })
      .catch(() => {})
      .finally(() => setMyHandleLoaded(true))
  }, [])

  const flashToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  // Deep-link to a specific track (?t=<itemId>) — this is what ShareCard's
  // per-track share link already points at. Instead of just scrolling it into
  // view within the full grid, show it as its own focused view: the shared
  // beat is unambiguous, everything else on the showcase is one tap away via
  // "See all N tracks" rather than competing for attention in a scrolled-to
  // position. Dashboard shortcuts open the overlays directly (?discover=1, ?share=1).
  const [focusedItemId, setFocusedItemId] = useState(null)
  useEffect(() => {
    if (state !== 'ready') return
    const q = new URLSearchParams(window.location.search)
    setFocusedItemId(q.get('t') || null)
    if (q.get('discover') === '1') setDiscoverOpen(true)
    publicApi.prefetchDiscover?.()   // warm the Discover feed + reels so the panel opens instantly
    if (q.get('share') === '1') setShareCard({ kind: 'profile' })
  }, [state])
  const focusedItem = focusedItemId ? items.find(i => i.id === focusedItemId) : null
  const backToFullShowcase = () => { setFocusedItemId(null); navigate(`/u/${handle}`, { replace: true }) }

  // Share — native share sheet where available, otherwise copy the link.
  const share = async (path, label) => {
    const url = `${window.location.origin}${path}`
    if (navigator.share) {
      try { await navigator.share({ title: 'dizko', text: label, url }); return } catch { return }  // cancelled
    }
    try { await navigator.clipboard.writeText(url); flashToast('Link copied ✓') }
    catch { flashToast(url) }
  }
  const shareProfile = () => setShareCard({ kind: 'profile' })
  const shareTrack   = (item) => setShareCard({ kind: 'track', item })

  const removeSpotify = async () => {
    if (!window.confirm('Remove the music player from your profile?')) return
    setP(prev => ({ ...prev, music_embed: null, spotify_embed: null }))
    try { await showcaseApi.updateProfile({ music_url: '' }) }
    catch (e) { flashToast(e?.message || 'Could not remove'); setP(prev => ({ ...prev })) }
  }

  useEffect(() => {
    if (!handle) return   // embedded: still resolving my own handle
    setTab('tracks'); setReposts(null)   // reset when switching profiles
    // Prefer the REAL account from the DB; fall back to the seeded client-side
    // demo only if there's no DB profile (e.g. before @dizko is seeded). This
    // lets @dizko become a real, followable/messageable account once seeded.
    const demo = getDemoProfile(handle)
    const useDemo = () => {
      const d = demoToProfile(demo)
      setP(d); setItems(d.items); setFollowing(false); setState('ready')
      document.title = `${d.display_name} (@${d.handle}) · dizko`
    }
    publicApi.profile(handle)
      .then(r => {
        if (r?.data) {
          setP(r.data); setItems(r.data.items || []); setFollowing(!!r.data.is_following)
          setState('ready')
          document.title = `${r.data.display_name} (@${r.data.handle}) · dizko`
        } else if (demo) { useDemo() }
        else setState('notfound')
      })
      .catch(() => { if (demo) useDemo(); else setState('notfound') })
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
    track(next ? 'producer_followed' : 'producer_unfollowed', { handle: p.handle })
    if (isDemo) return   // demo profiles: local UI only, no API
    try { next ? await showcaseApi.follow(p.id) : await showcaseApi.unfollow(p.id) }
    catch { setFollowing(!next) }   // revert on failure
  }

  const toggleLike = async (item) => {
    if (!requireAccount({ action: 'like', itemId: item.id })) return
    const next = !item.liked
    setItems(list => list.map(i => i.id === item.id
      ? { ...i, liked: next, like_count: Math.max(0, i.like_count + (next ? 1 : -1)) } : i))
    if (next) track('track_liked', { handle: p.handle })
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
    if (next) track('track_reposted', { handle: p.handle })
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
        track('track_downloaded', { handle: p.handle })
      }
    } catch (e) { alert(e.message || 'Download unavailable') }
  }

  const railNav = (label, icon, onClick, active = false) => (
    <button onClick={onClick} className="pp-railitem"
      style={{ width:'100%', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:11, padding:'9px 10px', borderRadius:10, fontFamily:'inherit', textAlign:'left',
        background:'transparent', color: active ? 'var(--t1)' : 'rgba(var(--fg),.6)', fontSize:13.5, fontWeight:500, transition:'color .12s, background .12s' }}>
      <span style={{ flexShrink:0, display:'flex' }}>{icon}</span>
      <span className="pp-raillabel" style={{ lineHeight:1, whiteSpace:'nowrap' }}>{label}</span>
    </button>
  )

  // Embedded inside the studio app shell: no own rail / topbar / full-page bg —
  // just the profile content, so the app's sidebar is the only one on screen.
  const Shell = embedded
    ? ({ children }) => (
        <div style={{ width:'100%', padding:'0 clamp(12px,2.5vw,28px) 60px', minWidth:0,
          color:'var(--t1)', fontFamily:'var(--font-ui)' }}>{children}</div>
      )
    : ({ children }) => (
    <div className="pp-shell" style={{ minHeight:'100vh', overflowX:'hidden', boxSizing:'border-box',
      background:'var(--bg)',
      color:'var(--t1)', fontFamily:'var(--font-ui)' }}>
      <style>{`
        .pp-rail { display:none; }
        .pp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 0 10px; }
        .pp-topbar-logo { display:flex; align-items:center; gap:9px; text-decoration:none; }
        .pp-content { padding:0 16px 60px; }
        .pp-railitem:hover { background:rgba(var(--fg),.05); color:var(--t1) !important; }
        @media (min-width:1000px) {
          .pp-rail { display:flex; width:210px; }
          .pp-content { padding-right:210px; }
          .pp-topbar { justify-content:flex-start; padding-top:14px; }
          .pp-topbar-logo { display:none; }
        }
      `}</style>

      {/* Sidebar — public-app nav on the RIGHT (desktop only). Simple, no logo. */}
      <aside className="pp-rail" style={{ position:'fixed', right:0, top:0, bottom:0, flexDirection:'column', gap:2,
        padding:'20px 16px 18px', borderLeft:'1px solid rgba(var(--fg),.08)', background:'transparent', zIndex:5, boxSizing:'border-box' }}>
        {railNav('Discover', <MagnifyingGlass size={20} />, () => setDiscoverOpen(true))}
        {p?.is_self && railNav('Add tracks', <PhPlus size={20} />, () => navigate('/profile/tracks'))}
        {p?.is_self && railNav('Edit profile', <UserCircle size={20} />, () => navigate('/profile/edit'))}
        {railNav('Share', <ShareNetwork size={20} />, () => shareProfile())}
        {!getToken() && (
          <div style={{ marginTop:'auto' }}>
            <button onClick={() => navigate('/login?join=1')} className="pp-rail-join" style={{ width:'100%', padding:'11px', borderRadius:10, border:'none', cursor:'pointer', background:'var(--t1)', color:'var(--bg)', fontSize:13.5, fontWeight:800, fontFamily:'inherit' }}>Join dizko</button>
          </div>
        )}
      </aside>

      {/* Content */}
      <div className="pp-content">
        <div style={{ width:'100%', maxWidth:980, margin:'0 auto' }}>
          {/* Top bar — logo hidden on desktop (sidebar has it); actions kept */}
          <div className="pp-topbar">
            <a href="/" className="pp-topbar-logo">
              <img src="/logo.png" alt="dizko" style={{ width:30, height:30, borderRadius:9, objectFit:'cover' }} />
              <span style={{ fontWeight:800, fontSize:18, letterSpacing:'-.4px', color:'var(--t1)' }}>dizko</span>
            </a>
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              {getToken() && <button onClick={backToApp} style={navLink}>← Back to app</button>}
              {getToken() && myHandle && (
                <button onClick={() => { navigate('/profile'); window.scrollTo(0,0) }} title="Go to my profile"
                  className="pp-me" style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 5px 4px 13px', borderRadius:100, cursor:'pointer',
                    background:'rgba(var(--fg),.06)', border:'1px solid rgba(var(--fg),.12)', fontFamily:'inherit' }}>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--t1)' }}>My profile</span>
                  <div style={{ width:30, height:30, borderRadius:'50%', overflow:'hidden', flexShrink:0,
                    background: myAvatar ? `center/cover url(${myAvatar})` : C.grad, border:'1.5px solid rgba(var(--fg),.25)' }} />
                </button>
              )}
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  )

  // Embedded on /profile with no handle claimed yet → nudge to Edit profile.
  if (embedded && !paramHandle && myHandleLoaded && !myHandle) return (
    <Shell>
      <div style={{ paddingTop:36 }}>
        <EmptyState
          icon={<svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0116 0v1"/></svg>}
          title="Set up your public profile"
          subtitle="Claim a handle to get your public page at dizko.ai/u/you."
          action={<Btn variant="outline" onClick={() => navigate('/profile/edit')}>Edit profile</Btn>}
        />
      </div>
    </Shell>
  )
  if (state === 'loading')  return <Shell><div style={{ textAlign:'center', color:'rgba(var(--fg),.5)', fontSize:14, paddingTop:60 }}><Spinner size={26} /></div></Shell>
  if (state === 'notfound') return (
    <Shell>
      <div style={{ textAlign:'center', paddingTop:50 }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>Profile not found</div>
        <div style={{ fontSize:13.5, color:'rgba(var(--fg),.5)', marginBottom:22 }}>This producer may be private or the handle doesn’t exist.</div>
        <a href="/" style={{ color:C.coral, fontWeight:600, textDecoration:'none', fontSize:14 }}>Go to dizko →</a>
      </div>
    </Shell>
  )

  // A shared-track link (?t=<itemId>) — the one beat that was actually sent,
  // front and center, with everything else one tap away instead of competing
  // for attention in a scrolled-to position in the full grid. The profile's
  // Apple/Spotify/YouTube embed still shows underneath — sharing one beat
  // doesn't mean hiding where the rest of the catalogue lives.
  if (focusedItem) {
    const embed = p.music_embed ? musicEmbed(p.music_embed) : null
    return (
      <Shell>
        <div style={{ maxWidth:560, margin:'0 auto', padding:'28px 4px 56px' }}>
          {/* Owner strip — who sent this, with a way to their full page */}
          <div style={{ display:'flex', alignItems:'center', gap:11, padding:'0 2px 24px' }}>
            <div onClick={() => { setFocusedItemId(null) }} style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:11, flex:1, minWidth:0 }}>
              <div style={{ width:38, height:38, borderRadius:'50%', flexShrink:0, overflow:'hidden',
                background: p.avatar_url ? `center/cover url(${p.avatar_url})` : C.grad, border:'1.5px solid rgba(var(--fg),.12)' }} />
              <div style={{ minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.display_name}</span>
                  {p.verified && (
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="#1d9bf0" style={{ flexShrink:0 }} aria-label="Verified"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.44 0-.863.08-1.256.23C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.393-.15-.816-.23-1.256-.23-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .44 0 .863-.08 1.256-.23.62 1.334 1.926 2.25 3.437 2.25s2.817-.916 3.438-2.25c.393.15.816.23 1.256.23 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.514 1.16-.688 1.943-1.99 1.943-3.486z"/><path d="M10.75 16.518l-3.75-3.75 1.5-1.5 2.25 2.25 4.75-4.75 1.5 1.5z" fill="#fff"/></svg>
                  )}
                </div>
                <div style={{ fontSize:11.5, color:'rgba(var(--fg),.42)' }}>
                  shared a beat with you · {fmt(p.follower_count)} follower{p.follower_count === 1 ? '' : 's'} · {items.length} track{items.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            {!p.is_self && (
              <button onClick={toggleFollow}
                style={following ? { ...ghostBtn, flexShrink:0 } : { ...ghostBtn, flexShrink:0, background:'rgba(109,90,230,.16)', border:'1px solid rgba(109,90,230,.4)', color:'#fff' }}>
                {following ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          <ShowcaseTrack item={focusedItem} isDemo={isDemo} ownerIsSelf={!!p.is_self}
            requireAccount={requireAccount} onLike={toggleLike} onDownload={download} onShare={shareTrack}
            onRepost={p.is_self ? null : toggleRepost}
            onRemove={p.is_self ? removeShowcaseItem : null} />

          {/* Same Apple Music / Spotify / YouTube embed as the full showcase —
              sharing one beat doesn't mean losing the rest of where to hear them. */}
          {embed && (
            <div style={{ marginTop:28 }}>
              <div style={{ fontSize:11.5, fontWeight:700, letterSpacing:'.03em', textTransform:'uppercase', color:'rgba(var(--fg),.4)', marginBottom:10 }}>On {embed.label}</div>
              <iframe title={embed.label} src={embed.src}
                width="100%" height={embed.short} frameBorder="0" loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                style={{ borderRadius:12, border:'none' }} />
            </div>
          )}

          {!getToken() && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap',
              marginTop:28, padding:'16px 18px', borderRadius:14, background:'rgba(var(--fg),.04)', border:'1px solid rgba(var(--fg),.08)' }}>
              <div style={{ fontSize:13, color:'rgba(var(--fg),.7)', lineHeight:1.5 }}>
                Like, follow & download <span style={{ color:'#fff', fontWeight:600 }}>{p.display_name}</span>’s work.
              </div>
              <button onClick={() => navigate('/login?join=1')}
                style={{ flexShrink:0, padding:'8px 18px', borderRadius:10, border:'none', cursor:'pointer', background:'var(--t1)', color:'var(--bg)', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
                Join dizko
              </button>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'center', marginTop:28 }}>
            <button onClick={backToFullShowcase}
              className="pp-seeall"
              style={{ padding:'7px 4px', border:'none', background:'none', cursor:'pointer', fontFamily:'inherit',
                fontSize:13, fontWeight:600, color:'rgba(var(--fg),.5)', display:'inline-flex', alignItems:'center', gap:6, transition:'color .15s' }}>
              See all {items.length} track{items.length === 1 ? '' : 's'} by {p.display_name}
              <span aria-hidden="true" style={{ transition:'transform .15s' }}>→</span>
            </button>
          </div>
          <style>{`.pp-seeall:hover{ color:${C.coral} !important; }`}</style>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <style>{`
        .pp-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:18px; align-items:start; }
        .pp-left, .pp-right { min-width:0; }
        .pp-actions { display:none; }
        @media (min-width: 860px) {
          .pp-grid { grid-template-columns: 340px minmax(0,1fr); gap:40px; }
          .pp-left { position:sticky; top:16px; }
        }
        @media (min-width: 1080px) {
          .pp-grid.pp-grid-3 { grid-template-columns: 300px minmax(0,1fr) 190px; gap:28px; }
          .pp-actions { display:flex; flex-direction:column; gap:2px; position:sticky; top:16px;
            padding-left:22px; border-left:1px solid rgba(var(--fg),.08); }
        }
        .pp-actbtn:hover { color:var(--t1) !important; background:rgba(var(--fg),.05) !important; }
        .pp-me > div { transition:border-color .15s; }
        .pp-me:hover > div { border-color:#fff; }
        @keyframes ppSpin { to { transform: rotate(360deg); } }
        .pp-disc { animation: ppSpin 20s linear infinite; }
        /* Decorative record is a desktop nicety — hide it on phones so the
           tracks aren't pushed down. */
        @media (max-width: 859px) { .pp-deco { display:none; } }
        /* Your own Add tracks / Share live in the sidebar on desktop; keep them
           in the header only when the sidebar is hidden (mobile / narrow). */
        .pp-self-actions { display:flex; gap:8px; flex-wrap:wrap; }
        @media (min-width: 1000px) { .pp-self-actions { display:none; } }
      `}</style>
      {/* Viewing someone else inside the app → light way back to your own page. */}
      {embedded && !p.is_self && (
        <button onClick={() => { navigate('/profile'); window.scrollTo(0, 0) }}
          onMouseEnter={e => { e.currentTarget.style.color='var(--t1)'; if (myHandle) publicApi.prefetchProfile(myHandle) }}
          style={{ display:'inline-flex', alignItems:'center', gap:7, margin:'4px 0 14px', padding:'2px 0',
            border:'none', cursor:'pointer', background:'transparent', color:'rgba(var(--fg),.5)', fontFamily:'inherit', fontSize:12.5, fontWeight:500, transition:'color .12s' }}
          onMouseLeave={e => e.currentTarget.style.color='rgba(var(--fg),.5)'}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to my profile
        </button>
      )}
      <div className={`pp-grid${embedded ? ' pp-grid-3' : ''}`}>
      <div className="pp-left">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:18, padding:'14px 4px 14px' }}>
        <div style={{ width:88, height:88, borderRadius:'50%', flexShrink:0, overflow:'hidden',
          border:'2px solid rgba(var(--fg),.12)', boxShadow:'0 10px 30px rgba(0,0,0,.5)',
          background: p.avatar_url ? `center/cover url(${p.avatar_url})` : C.grad }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', gap:26 }}>
            <Stat n={items.length} label="tracks" />
            <Stat n={p.follower_count} label="followers" />
            <Stat n={p.following_count} label="following" />
          </div>
        </div>
      </div>

      {/* Actions — under the stats */}
      <div style={{ padding:'0 4px 18px' }}>
        {p.is_self ? (
          <div className="pp-self-actions">
            <button onClick={() => navigate('/profile/tracks')} style={{ ...ghostBtn, border:'none', background:'rgba(var(--fg),.08)' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add tracks
            </button>
            <button onClick={shareProfile} title="Share profile" style={{ ...ghostBtn, border:'none', background:'rgba(var(--fg),.08)' }}>{shareIcon} Share</button>
          </div>
        ) : (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={toggleFollow}
              style={following ? ghostBtn : { ...ghostBtn, background:'rgba(109,90,230,.16)', border:'1px solid rgba(109,90,230,.4)', color:'#fff' }}>
              {following ? 'Following' : 'Follow'}
            </button>
            <button onClick={() => contact('message')} style={ghostBtn}>Message</button>
          </div>
        )}
      </div>

      {/* Identity */}
      <div style={{ padding:'0 4px 22px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <div style={{ fontSize:16, fontWeight:800 }}>{p.display_name}</div>
          {p.verified && (
            <svg width={17} height={17} viewBox="0 0 24 24" fill="#1d9bf0" aria-label="Verified" title="Verified" style={{ flexShrink:0 }}>
              <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.44 0-.863.08-1.256.23C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.393-.15-.816-.23-1.256-.23-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .44 0 .863-.08 1.256-.23.62 1.334 1.926 2.25 3.437 2.25s2.817-.916 3.438-2.25c.393.15.816.23 1.256.23 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.514 1.16-.688 1.943-1.99 1.943-3.486z"/>
              <path d="M10.75 16.518l-3.75-3.75 1.5-1.5 2.25 2.25 4.75-4.75 1.5 1.5z" fill="#fff"/>
            </svg>
          )}
          {isDemo && !p.verified && <span style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.06em', padding:'2px 7px', borderRadius:6, background:'rgba(124,108,240,.18)', color:C.coral }}>DEMO</span>}
        </div>
        <div style={{ fontSize:13, color:'rgba(var(--fg),.45)', marginBottom:p.bio?8:0 }}>@{p.handle}</div>
        {p.bio && <div style={{ fontSize:13.5, lineHeight:1.5, color:'rgba(var(--fg),.78)', whiteSpace:'pre-wrap' }}>{p.bio}</div>}
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
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid rgba(var(--fg),.08)' }}>
        {[['tracks', `Tracks${items.length ? ` · ${items.length}` : ''}`], ['reposts', `Reposts${p.repost_count ? ` · ${p.repost_count}` : ''}`]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:700, padding:'8px 12px',
              color: tab === k ? '#fff' : 'rgba(var(--fg),.45)', borderBottom: tab === k ? `2px solid ${C.coral}` : '2px solid transparent', marginBottom:-1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tracks' ? (
        items.length === 0 ? (
          <div style={{ borderRadius:18, overflow:'hidden', border:'1px solid rgba(var(--fg),.08)', background:'#0e0e12' }}>
            <img src="/share/eras.png" alt="" style={{ width:'100%', display:'block' }} />
            <div style={{ padding:'22px 24px 28px', textAlign:'center' }}>
              <div style={{ fontSize:16, fontWeight:800, marginBottom:6 }}>{p.is_self ? 'Showcase your first track' : 'No tracks showcased yet.'}</div>
              {p.is_self && (
                <>
                  <div style={{ fontSize:13, color:'rgba(var(--fg),.55)', marginBottom:18 }}>Pick your best sounds from your library to show the world.</div>
                  <button onClick={() => navigate('/profile/tracks')}
                    style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', background:'rgba(var(--fg),.12)', color:'#fff', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
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
        repostsLoading || reposts === null ? <div style={{ color:'rgba(var(--fg),.4)', fontSize:13, padding:'30px 0', textAlign:'center' }}>Loading…</div> :
        reposts.length === 0 ? (
          <div style={{ textAlign:'center', padding:'46px 24px', borderRadius:16, border:'1px dashed rgba(var(--fg),.12)', color:'rgba(var(--fg),.5)', fontSize:13 }}>
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
          marginTop:24, padding:'16px 18px', borderRadius:14, background:'rgba(var(--fg),.04)', border:'1px solid rgba(var(--fg),.08)' }}>
          <div style={{ fontSize:13, color:'rgba(var(--fg),.7)', lineHeight:1.5 }}>
            Like, follow & download <span style={{ color:'#fff', fontWeight:600 }}>{p.display_name}</span>’s work.
          </div>
          <button onClick={() => navigate('/login?join=1')}
            style={{ flexShrink:0, padding:'8px 18px', borderRadius:10, border:'none', cursor:'pointer', background:'var(--t1)', color:'var(--bg)', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            Join dizko
          </button>
        </div>
      )}
      {/* Music embed — Spotify / Apple Music / YouTube. Compact by default,
          expandable for albums / playlists. Owner can remove it (with a confirm). */}
      {p.music_embed && (() => {
        const e = musicEmbed(p.music_embed)
        if (!e) return null
        return (
          <div style={{ marginTop:24 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.2px', color:'var(--t1)' }}>On {e.label}</div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                {e.canExpand && (
                  <button onClick={() => setSpotifyExpanded(v => !v)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(var(--fg),.5)', fontSize:12, fontWeight:600, fontFamily:'inherit', padding:'4px 6px' }}>
                    {spotifyExpanded ? 'Show less ▴' : 'Show all songs ▾'}
                  </button>
                )}
                {p.is_self && (
                  <button onClick={removeSpotify} title="Remove" aria-label="Remove music"
                    style={{ width:26, height:26, borderRadius:7, border:'none', cursor:'pointer', background:'rgba(var(--fg),.06)', color:'rgba(var(--fg),.55)', display:'flex', alignItems:'center', justifyContent:'center' }}
                    onMouseEnter={ev => { ev.currentTarget.style.color='#ef4444'; ev.currentTarget.style.background='rgba(239,68,68,.1)' }}
                    onMouseLeave={ev => { ev.currentTarget.style.color='rgba(var(--fg),.55)'; ev.currentTarget.style.background='rgba(var(--fg),.06)' }}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
            </div>
            <iframe title={e.label} src={e.src}
              width="100%" height={e.canExpand && spotifyExpanded ? e.tall : e.short} frameBorder="0" loading="lazy"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              style={{ borderRadius:12, border:'none', transition:'height .2s' }} />
          </div>
        )
      })()}
      </div>{/* /pp-right */}

      {/* Right action rail (desktop). Simple, no highlight. Owner tools when it's
          your page; just Discover + Share when viewing someone else. */}
      {embedded && (
        <aside className="pp-actions">
          {[
            { label:'Discover',     icon:<MagnifyingGlass size={19} />, onClick: () => setDiscoverOpen(true) },
            ...(p.is_self ? [
              { label:'Add tracks',   icon:<PhPlus size={19} />,     onClick: () => navigate('/profile/tracks') },
              { label:'Edit profile', icon:<UserCircle size={19} />, onClick: () => navigate('/profile/edit') },
            ] : []),
            { label:'Share',        icon:<ShareNetwork size={19} />,    onClick: () => shareProfile() },
          ].map(a => (
            <button key={a.label} onClick={a.onClick} className="pp-actbtn"
              style={{ display:'flex', alignItems:'center', gap:11, width:'100%', padding:'9px 10px', borderRadius:10, border:'none', cursor:'pointer',
                background:'transparent', color:'rgba(var(--fg),.6)', fontFamily:'inherit', fontSize:13.5, fontWeight:500, textAlign:'left' }}>
              <span style={{ flexShrink:0, display:'flex' }}>{a.icon}</span>{a.label}
            </button>
          ))}
        </aside>
      )}
      </div>{/* /pp-grid */}

      <div id="pp-discover"><DiscoverProducers currentHandle={p.handle} navigate={navigate} /></div>

      {dm && <DmThread profile={p} kind={dm.kind} isDemo={isDemo} myId={myId} onClose={() => setDm(null)} onError={flashToast} />}

      {shareCard && (
        <ShareCard kind={shareCard.kind} item={shareCard.item}
          profile={{ handle: p.handle, display_name: p.display_name, avatar_url: p.avatar_url }}
          canEditPhoto={!!p.is_self}
          onClose={() => setShareCard(null)} />
      )}

      {/* Discover — full-screen pop-in from the bottom-right (portaled to body so
          it covers the sidebar instead of rendering inside the padded content) */}
      {discoverOpen && createPortal(
        <div style={{ position:'fixed', inset:0, zIndex:1100, background:'var(--bg)', color:'var(--t1)', display:'flex', flexDirection:'column',
          transformOrigin:'bottom right', animation:'ppDiscover .3s cubic-bezier(.2,.75,.2,1)', fontFamily:'var(--font-ui)' }}>
          <style>{`@keyframes ppDiscover{from{transform:scale(.4) translate(45%,45%);opacity:0}to{transform:scale(1) translate(0,0);opacity:1}}`}</style>
          <div style={{ display:'flex', justifyContent:'flex-end', padding:'16px 22px 0' }}>
            <button onClick={() => setDiscoverOpen(false)} aria-label="Close"
              style={{ width:34, height:34, borderRadius:10, border:'none', cursor:'pointer', background:'rgba(var(--fg),.07)', color:'rgba(var(--fg),.7)', fontSize:17 }}>✕</button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'8px 24px 40px', maxWidth:920, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
            <div style={{ textAlign:'center', marginBottom:26 }}>
              <div style={{ fontSize:32, fontWeight:900, letterSpacing:'-.8px' }}>Discover</div>
              <div style={{ fontSize:14, color:'rgba(var(--fg),.5)', marginTop:7 }}>Producers and fresh sounds across dizko 🎧</div>
            </div>
            <DiscoverProducers currentHandle={p?.handle} layout="grid" bare
              navigate={(path) => { setDiscoverOpen(false); navigate(path); window.scrollTo(0, 0) }} />
            <ReelsRow onOpen={(h) => { setDiscoverOpen(false); navigate(`/u/${h}`); window.scrollTo(0, 0) }} />
          </div>
        </div>,
        document.body
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
        const c = COPY[authPrompt.action] || { t:'Join dizko', s:'Create a free account to like, follow, comment and download.' }
        return (
          <div onClick={() => setAuthPrompt(null)}
            style={{ position:'fixed', inset:0, zIndex:1002, background:'rgba(0,0,0,.6)', backdropFilter:'blur(6px)',
              display:'flex', alignItems:'center', justifyContent:'center', padding:20, animation:'ppFade .18s ease' }}>
            <style>{`@keyframes ppFade{from{opacity:0}to{opacity:1}} @keyframes ppRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            <div onClick={e => e.stopPropagation()}
              style={{ width:'100%', maxWidth:360, background:'var(--surface)', border:'1px solid rgba(var(--fg),.1)', borderRadius:20,
                padding:'26px 24px', textAlign:'center', animation:'ppRise .22s cubic-bezier(.2,.7,.2,1)' }}>
              <div style={{ width:60, height:60, borderRadius:'50%', margin:'0 auto 16px', background: p.avatar_url ? `center/cover url(${p.avatar_url})` : C.grad, border:'2px solid rgba(var(--fg),.12)' }} />
              <div style={{ fontSize:17, fontWeight:800, marginBottom:7, letterSpacing:'-.2px' }}>{c.t}</div>
              <div style={{ fontSize:13, color:'rgba(var(--fg),.6)', lineHeight:1.5, marginBottom:22 }}>{c.s}</div>
              <button onClick={() => navigate('/login?join=1')}
                style={{ width:'100%', padding:'12px', borderRadius:12, border:'none', cursor:'pointer', background:'var(--t1)', color:'var(--bg)', fontSize:14, fontWeight:700, fontFamily:'inherit', marginBottom:10 }}>
                Create a free account
              </button>
              <button onClick={() => navigate('/login')}
                style={{ width:'100%', padding:'11px', borderRadius:12, border:'none', cursor:'pointer', background:'transparent', color:'rgba(var(--fg),.7)', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
                I already have an account
              </button>
              <button onClick={() => setAuthPrompt(null)}
                style={{ marginTop:6, background:'none', border:'none', cursor:'pointer', color:'rgba(var(--fg),.4)', fontSize:12.5, fontFamily:'inherit' }}>
                Maybe later
              </button>
            </div>
          </div>
        )
      })()}

      {toast && (
        <div style={{ position:'fixed', bottom:26, left:'50%', transform:'translateX(-50%)', zIndex:1001,
          padding:'11px 22px', borderRadius:100, background:'var(--t1)', color:'var(--bg)', fontSize:13, fontWeight:700, boxShadow:'0 10px 30px rgba(0,0,0,.35)' }}>{toast}</div>
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
      if (!isDemo) { const r = await messagesApi.send(profile.id, t); if (r?.data) setThread(list => list.map(m => m.id === mine.id ? r.data : m)); track('message_sent', { from: 'public_profile' }) }
      else setTimeout(() => setThread(list => [...list, { id: `r-${Date.now()}`, from_user_id: profile.id, to_user_id: myId, text: 'thanks for reaching out! 🙏 (demo reply)', created_at: new Date().toISOString() }]), 1100)
    } catch (e) { onError?.(e.message || 'Could not send'); setThread(list => list.filter(m => m.id !== mine.id)) }
    setSending(false)
  }

  const likeMsg = async (m) => {
    if (isDemo || String(m.id).startsWith('tmp-')) return
    const next = !m.liked
    setThread(l => l.map(x => x.id === m.id ? { ...x, liked: next } : x))
    try { await messagesApi.likeMessage(m.id) } catch { setThread(l => l.map(x => x.id === m.id ? { ...x, liked: !next } : x)) }
  }
  const deleteMsg = async (m) => {
    if (!window.confirm('Delete this message?')) return
    const prev = thread
    setThread(l => l.filter(x => x.id !== m.id))
    if (isDemo || String(m.id).startsWith('tmp-')) return
    try { await messagesApi.deleteMessage(m.id) } catch { setThread(prev) }
  }

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,.6)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', padding:18, animation:'ppFade .18s ease' }}>
      <style>{`@keyframes ppFade{from{opacity:0}to{opacity:1}}@keyframes ppRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}} .dm-msgdel{opacity:0;transition:opacity .12s} .dm-msg:hover .dm-msgdel{opacity:1} @media (hover:none){.dm-msgdel{opacity:1}}`}</style>
      <div onClick={e => e.stopPropagation()}
        style={{ width:'100%', maxWidth:400, height:'min(78vh, 540px)', background:'var(--surface)', border:'1px solid rgba(var(--fg),.1)',
          borderRadius:20, display:'flex', flexDirection:'column', overflow:'hidden', animation:'ppRise .22s cubic-bezier(.2,.7,.2,1)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:11, padding:'14px 16px', borderBottom:'1px solid rgba(var(--fg),.07)' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', flexShrink:0, background: profile.avatar_url ? `center/cover url(${profile.avatar_url})` : C.grad }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, lineHeight:1.2 }}>{profile.display_name}</div>
            <div style={{ fontSize:11.5, color:'rgba(var(--fg),.45)' }}>@{profile.handle}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width:30, height:30, borderRadius:8, background:'rgba(var(--fg),.06)', border:'none', cursor:'pointer', color:'rgba(var(--fg),.6)', fontSize:15, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:8 }}>
          {loading ? <div style={{ color:'rgba(var(--fg),.4)', fontSize:13, textAlign:'center', marginTop:20 }}>Loading…</div> :
           thread.length === 0 ? (
            <div style={{ margin:'auto', textAlign:'center', padding:'0 10px' }}>
              <div style={{ width:56, height:56, borderRadius:'50%', margin:'0 auto 12px', background: profile.avatar_url ? `center/cover url(${profile.avatar_url})` : C.grad, border:'2px solid rgba(var(--fg),.1)' }} />
              <div style={{ fontSize:14.5, fontWeight:700, marginBottom:4 }}>{kind === 'collab' ? `Collab with ${profile.display_name}` : profile.display_name}</div>
              <div style={{ fontSize:12.5, color:'rgba(var(--fg),.5)', lineHeight:1.5 }}>{kind === 'collab' ? 'Pitch your idea and start something together.' : 'Start the conversation — say hi 👋'}</div>
            </div>
          ) : thread.map(m => {
            const mine = m.from_user_id === myId
            return (
              <div key={m.id} className="dm-msg" style={{ display:'flex', flexDirection:'column', alignItems: mine ? 'flex-end' : 'flex-start', gap:2 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexDirection: mine ? 'row-reverse' : 'row', maxWidth:'82%' }}>
                  <div onDoubleClick={() => likeMsg(m)} title="Double-click to like"
                    style={{ position:'relative', padding:'9px 14px', borderRadius:18, fontSize:13.5, lineHeight:1.4, wordBreak:'break-word',
                      background: mine ? C.coral : 'rgba(var(--fg),.09)', color: mine ? '#fff' : 'var(--t1)',
                      borderBottomRightRadius: mine ? 5 : 18, borderBottomLeftRadius: mine ? 18 : 5 }}>
                    {m.text}
                    {m.liked && <span style={{ position:'absolute', bottom:-9, [mine ? 'left' : 'right']:8, fontSize:12, lineHeight:1, background:'var(--surface)', borderRadius:100, padding:'1px 3px', boxShadow:'0 1px 3px rgba(0,0,0,.3)' }}>❤️</span>}
                  </div>
                  {mine && !String(m.id).startsWith('tmp-') && (
                    <button className="dm-msgdel" onClick={() => deleteMsg(m)} aria-label="Delete message"
                      style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(var(--fg),.4)', fontSize:13, flexShrink:0, padding:2 }}>✕</button>
                  )}
                </div>
                {m.created_at && <span style={{ fontSize:10, color:'rgba(var(--fg),.35)', padding:'0 5px' }}>{timeAgo(m.created_at)}</span>}
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px', borderTop:'1px solid rgba(var(--fg),.07)' }}>
          <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Message…"
            style={{ flex:1, minWidth:0, padding:'11px 16px', borderRadius:100, border:'1px solid rgba(var(--fg),.12)', background:'rgba(var(--fg),.05)', color:'#fff', fontSize:13.5, fontFamily:'inherit', outline:'none' }} />
          <button onClick={send} disabled={!text.trim() || sending} aria-label="Send"
            style={{ flexShrink:0, width:40, height:40, borderRadius:'50%', border:'none', cursor:'pointer', background: text.trim() ? C.coral : 'rgba(var(--fg),.12)', color:'#fff', fontSize:15, transition:'background .15s', opacity:sending?.6:1 }}>➤</button>
        </div>
      </div>
    </div>
  )
}

// Isolated so typing in the search box only re-renders this block — not the
// whole profile (which made each keystroke feel laggy / letter-by-letter).
function DiscoverProducers({ currentHandle, navigate, layout = 'lane', bare = false }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => {
    const query = q.trim()
    const t = setTimeout(() => {
      // Empty query returns the default Discover feed (real public profiles).
      publicApi.searchProfiles(query).then(r => {
        const real = (r?.data || []).map(x => ({ ...x, trackCount: x.track_count }))
        const seen = new Set(real.map(x => x.handle))
        const ql = query.toLowerCase()
        const demos = DEMO_PROFILES
          .filter(d => !seen.has(d.handle) && (!query || d.display_name.toLowerCase().includes(ql) || d.handle.includes(ql)))
          .map(d => ({ handle: d.handle, display_name: d.display_name, avatar_url: d.avatar_url, follower_count: d.follower_count, trackCount: d.items.length }))
        setResults([...real, ...demos].filter(d => d.handle !== currentHandle))
      }).catch(() => setResults([]))
    }, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, currentHandle])

  const searching = q.trim().length > 0
  const list = results || []

  return (
    <>
      <style>{`
        .pp-discover { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; }
        .pp-discover::-webkit-scrollbar { height:6px; }
        .pp-discover::-webkit-scrollbar-thumb { background:rgba(var(--fg),.12); border-radius:3px; }
        .pp-discover > .pp-pcard { flex:0 0 148px; scroll-snap-align:start; }
        .pp-dgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:14px; }
        .pp-pcard { transition:transform .12s ease, border-color .12s ease, background .12s ease; }
        .pp-pcard:hover { transform:translateY(-3px); border-color:rgba(124,108,240,.4)!important; background:rgba(var(--fg),.06)!important; }
      `}</style>
      <div style={{ marginTop: bare ? 0 : 44 }}>
        {!bare && <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.2px', color:'var(--t1)', marginBottom:14 }}>Discover</div>}

        <div style={{ position:'relative', maxWidth: bare ? 460 : 380, margin: bare ? '0 auto 26px' : '0 0 18px' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg),.35)" strokeWidth={2} strokeLinecap="round"
            style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or @handle"
            style={{ width:'100%', padding: bare ? '12px 14px 12px 40px' : '9px 12px 9px 34px', borderRadius: bare ? 100 : 10, border:'1px solid rgba(var(--fg),.1)', background:'rgba(var(--fg),.04)', color:'#fff', fontSize:13.5, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
        </div>

        {bare && <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.2px', color:'var(--t1)', marginBottom:14 }}>Producers</div>}

        {results === null ? <div style={{ fontSize:12.5, color:'rgba(var(--fg),.4)', padding:'8px 2px' }}>{searching ? 'Searching…' : 'Loading…'}</div> :
         list.length === 0 ? <div style={{ fontSize:12.5, color:'rgba(var(--fg),.4)', padding:'8px 2px' }}>{searching ? `No users found for “${q}”.` : 'No public producers yet.'}</div> : (
          <div className={layout === 'grid' ? 'pp-dgrid' : 'pp-discover'}>
            {list.map(d => {
              const tracks = d.items?.length ?? d.trackCount
              return (
                <button key={d.handle} className="pp-pcard"
                  onClick={() => { navigate(`/u/${d.handle}`); window.scrollTo(0, 0) }}
                  onMouseEnter={() => { if (!isDemoHandle(d.handle)) publicApi.prefetchProfile(d.handle) }}
                  style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', gap:3, padding:'20px 14px', borderRadius:16, cursor:'pointer',
                    background:'rgba(var(--fg),.035)', border:'1px solid rgba(var(--fg),.07)', fontFamily:'inherit', color:'var(--t1)' }}>
                  <div style={{ width:64, height:64, borderRadius:'50%', marginBottom:10, background: d.avatar_url ? `center/cover url(${d.avatar_url})` : C.grad, border:'2px solid rgba(var(--fg),.1)' }} />
                  <div style={{ display:'flex', alignItems:'center', gap:4, maxWidth:'100%' }}>
                    <span style={{ fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.display_name}</span>
                    {d.verified && (
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="#1d9bf0" style={{ flexShrink:0 }} aria-label="Verified"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.44 0-.863.08-1.256.23C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.393-.15-.816-.23-1.256-.23-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .44 0 .863-.08 1.256-.23.62 1.334 1.926 2.25 3.437 2.25s2.817-.916 3.438-2.25c.393.15.816.23 1.256.23 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.514 1.16-.688 1.943-1.99 1.943-3.486z"/><path d="M10.75 16.518l-3.75-3.75 1.5-1.5 2.25 2.25 4.75-4.75 1.5 1.5z" fill="#fff"/></svg>
                    )}
                  </div>
                  <div style={{ fontSize:11.5, color:'rgba(var(--fg),.4)' }}>@{d.handle}</div>
                  <div style={{ fontSize:11, color:'rgba(var(--fg),.5)', marginTop:7 }}>{fmt(d.follower_count)} followers{tracks != null ? ` · ${tracks} tracks` : ''}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// "Reels" — a shuffled strip of playable audio from producers. Tap play to
// listen, tap the card to jump to that producer's profile.
function ReelsRow({ onOpen }) {
  const audioRef = useRef(null)
  const [playingId, setPlayingId] = useState(null)

  const demoReels = useMemo(() => {
    const all = []
    for (const d of DEMO_PROFILES) {
      for (const it of (d.items || [])) {
        if (it.audio) all.push({ id: `${d.handle}-${it.id}`, audio: it.audio, title: it.title, instrument: it.instrument, owner: { handle: d.handle, display_name: d.display_name, avatar_url: d.avatar_url } })
      }
    }
    return all
  }, [])
  const [reels, setReels] = useState([])
  useEffect(() => {
    publicApi.reels().then(r => {
      const real = (r?.data || []).map(x => ({ id: x.id, audio: `${BASE}${x.stream_url}`, title: x.title, instrument: x.instrument, owner: x.owner }))
      const pool = real.length ? real : demoReels
      const shuffled = [...pool]
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
      setReels(shuffled)
    }).catch(() => setReels(demoReels))
  }, [demoReels])

  const toggle = (r) => {
    const el = audioRef.current
    if (!el) return
    if (playingId === r.id) { el.pause(); setPlayingId(null); return }
    el.src = r.audio
    el.play().then(() => setPlayingId(r.id)).catch(() => setPlayingId(null))
  }

  if (reels.length === 0) return null

  return (
    <div style={{ marginTop:36 }}>
      <style>{`
        .pp-reels { display:flex; gap:12px; overflow-x:auto; padding-bottom:10px; -webkit-overflow-scrolling:touch; }
        .pp-reels::-webkit-scrollbar { height:6px; } .pp-reels::-webkit-scrollbar-thumb { background:rgba(var(--fg),.12); border-radius:3px; }
        .pp-reel { transition:transform .14s ease; }
        .pp-reel:hover { transform:translateY(-3px); }
      `}</style>
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display:'none' }} />
      <div style={{ fontSize:13, fontWeight:800, letterSpacing:'-.2px', color:'var(--t1)', marginBottom:4 }}>Fresh sounds</div>
      <div style={{ fontSize:12, color:'rgba(var(--fg),.4)', marginBottom:14 }}>Tap to listen · tap the card to open the producer.</div>
      <div className="pp-reels">
        {reels.map(r => {
          const playing = playingId === r.id
          return (
            <div key={r.id} className="pp-reel" onClick={() => onOpen(r.owner.handle)}
              onMouseEnter={() => { if (!isDemoHandle(r.owner.handle)) publicApi.prefetchProfile(r.owner.handle) }}
              style={{ position:'relative', flex:'0 0 158px', height:248, borderRadius:18, overflow:'hidden', cursor:'pointer',
                background: r.owner.avatar_url ? `center/cover url(${r.owner.avatar_url})` : C.grad, border: playing ? `2px solid ${C.coral}` : '2px solid transparent' }}>
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(transparent 25%, rgba(0,0,0,.55) 55%, rgba(0,0,0,.92))' }} />
              <button onClick={(e) => { e.stopPropagation(); toggle(r) }} aria-label="Play"
                style={{ position:'absolute', top:'40%', left:'50%', transform:'translate(-50%,-50%)', width:50, height:50, borderRadius:'50%', border:'none', cursor:'pointer',
                  background:'rgba(var(--fg),.92)', color:'var(--bg)', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 6px 20px rgba(0,0,0,.4)' }}>
                {playing ? '❚❚' : '▶'}
              </button>
              <div style={{ position:'absolute', left:0, right:0, bottom:0, padding:'12px 13px', color:'#fff' }}>
                <div style={{ fontSize:13, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.title}</div>
                <div style={{ fontSize:11.5, color:'rgba(255,255,255,.8)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>@{r.owner.handle}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ n, label }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:15, fontWeight:800 }}>{fmt(n)}</div>
      <div style={{ fontSize:11.5, color:'rgba(var(--fg),.45)' }}>{label}</div>
    </div>
  )
}

const btn = (bg, color) => ({
  padding:'7px 20px', borderRadius:10, border:'none', cursor:'pointer',
  background:bg, color, fontSize:13.5, fontWeight:700, fontFamily:'inherit',
})

const navLink = { background:'none', border:'none', cursor:'pointer', fontSize:12.5, color:'rgba(var(--fg),.6)', fontWeight:600, fontFamily:'inherit' }

const Ico = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d={d} /></svg>
)

const shareIcon = (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)

// Subtle, small action button used on your own profile (Add tracks / Share).
const ghostBtn = { padding:'6px 14px', borderRadius:9, border:'1px solid rgba(var(--fg),.18)', background:'transparent',
  color:'rgba(var(--fg),.85)', fontSize:12.5, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
  display:'inline-flex', alignItems:'center', gap:6 }

// Turn a stored "<provider>:<payload>" into an embed iframe descriptor.
function musicEmbed(embed) {
  if (!embed) return null
  const i = embed.indexOf(':'); if (i < 0) return null
  const prov = embed.slice(0, i), payload = embed.slice(i + 1)
  if (prov === 'spotify') {
    const isTrack = payload.startsWith('track/')
    return { label:'Spotify', src:`https://open.spotify.com/embed/${payload}?utm_source=dizko`, short:152, tall:380, canExpand:!isTrack }
  }
  if (prov === 'apple') {
    const isSong = payload.includes('?i=')
    return { label:'Apple Music', src:`https://embed.music.apple.com/${payload}`, short:isSong?175:175, tall:450, canExpand:!isSong }
  }
  if (prov === 'youtube') {
    const src = payload.startsWith('list/') ? `https://www.youtube.com/embed/videoseries?list=${payload.slice(5)}` : `https://www.youtube.com/embed/${payload}`
    return { label:'YouTube', src, short:220, tall:220, canExpand:false }
  }
  return null
}

function fmt(n) {
  n = Number(n) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
