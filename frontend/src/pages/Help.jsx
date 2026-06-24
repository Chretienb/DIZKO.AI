import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Rocket, MusicNotes, Microphone, UploadSimple, UsersThree, CreditCard, ShieldCheck } from '@phosphor-icons/react'
import { C } from '../components/ui/index.jsx'

// ── Knowledge base content ────────────────────────────────────────────────────
// Each category groups a few real Q&A articles. Counts are derived from the data
// so they never drift out of sync.
const CATEGORIES = [
  {
    key: 'getting-started', name: 'Getting Started',
    Icon: Rocket,
    articles: [
      { q: 'What is Dizko?', a: 'Dizko is a real-time music collaboration platform. Upload your stems, organize them into projects and songs, mix and bounce them in the Studio, and share with your collaborators — all in one place.' },
      { q: 'How do I create my first project?', a: 'On the Projects page, click “New Project”, give it a name, choose Single or Album, then upload your stems. Your project opens with everything organized by instrument.' },
      { q: 'How do I upload stems?', a: 'Open a project and click Upload, or drag your audio files straight onto the page. Dizko automatically detects the instrument, key and BPM and names each stem for you.' },
    ],
  },
  {
    key: 'projects', name: 'Projects & Songs',
    Icon: MusicNotes,
    articles: [
      { q: 'What is the difference between a Single and an Album?', a: 'An Album holds multiple songs; a Single is one song. Add more songs to an album any time with “New Song”. Each song keeps its own stems, key, BPM and mixes.' },
      { q: 'How are my stems organized?', a: 'Stems are grouped by type — Master, Drums, Bass / 808, Melody, Vocals and more — under the song they belong to, so your largest projects stay tidy.' },
      { q: 'Can I rename a song or project?', a: 'Yes. Click the name at the top of the project or song to edit it. Stem names you’ve set are protected and won’t be auto-renamed.' },
    ],
  },
  {
    key: 'studio', name: 'Studio & Bouncing',
    Icon: Microphone,
    articles: [
      { q: 'How do I play all my stems together?', a: 'Add stems to the board and hit “Play all”. Every stem is locked to one master timeline so they stay perfectly in sync as they play.' },
      { q: 'What is a bounce?', a: 'A bounce plays the stems on your board together so you can hear the full track. Smart Mix can also generate a balanced version with EQ, panning and reverb applied.' },
      { q: 'Why does the very first play take a moment?', a: 'The first time, Dizko loads and decodes your stems. After that they’re cached, so every replay — and reopening the project later — is basically instant.' },
      { q: 'How do I transpose a stem?', a: 'Use the ♪ +/- control on a track to shift its pitch up or down in semitones. The stem stays the same length, so it stays in sync with the rest of the board.' },
    ],
  },
  {
    key: 'uploads', name: 'Uploading Stems',
    Icon: UploadSimple,
    articles: [
      { q: 'What file formats are supported?', a: 'WAV, MP3, FLAC and most common audio formats. Large files upload directly from your browser and resume automatically if your connection drops.' },
      { q: 'What is the naming convention?', a: 'Dizko uses [SONG][STEM TYPE][KEY][BPM] — for example “TWIN_Bass_Am_102”. If you’ve already given a stem a good name, Dizko keeps it as-is.' },
      { q: 'My upload looked like it did nothing — what happened?', a: 'Very large files are processed in the background so the tab never freezes. Give it a few seconds; the stem appears as soon as it’s registered, and finishes analyzing shortly after.' },
    ],
  },
  {
    key: 'crew', name: 'Collaboration & Crew',
    Icon: UsersThree,
    articles: [
      { q: 'How do I invite collaborators?', a: 'Open a project and click Share / Invite, or use “Invite friends” in the ⋯ menu under your avatar. Invited collaborators can view and contribute based on the access you give them.' },
      { q: 'Who can delete stems?', a: 'The person who uploaded a stem, or the project owner, can delete it. Masters and saved mixes can only be removed by the owner.' },
      { q: 'Can I see who did what?', a: 'Yes — the Activity feed on each project shows who uploaded, mixed or commented, scoped to the song you’re viewing.' },
    ],
  },
  {
    key: 'billing', name: 'Accounts & Billing',
    Icon: CreditCard,
    articles: [
      { q: 'How does the free trial work?', a: 'Dizko is free for your first 2 months — no charge until month 3. You can create projects, invite your crew and export the whole time.' },
      { q: 'How do I manage my plan?', a: 'Go to Account → Billing & Plan to see your current plan, days remaining and payment details.' },
      { q: 'How much storage do I get, and where do I check it?', a: 'Your storage usage and limit are shown on the Account page under your profile.' },
    ],
  },
  {
    key: 'rights', name: 'Rights & Ownership',
    Icon: ShieldCheck,
    articles: [
      { q: 'Who owns the music I upload?', a: 'You do. You keep full ownership of the content you upload to Dizko. See our Terms of Service for the details.' },
      { q: 'Can I delete my data?', a: 'Yes. You can delete your account at any time from settings; your data is removed within 30 days.' },
    ],
  },
]

const ALL = CATEGORIES.flatMap(c => c.articles.map(a => ({ ...a, cat: c.name, catKey: c.key })))

export default function PageHelp() {
  const navigate = useNavigate()
  const [query, setQuery]   = React.useState('')
  const [activeCat, setCat] = React.useState(null)
  const [open, setOpen]     = React.useState(null)   // expanded article key

  const q = query.trim().toLowerCase()
  const results = q
    ? ALL.filter(a => (a.q + ' ' + a.a + ' ' + a.cat).toLowerCase().includes(q))
    : activeCat
      ? ALL.filter(a => a.catKey === activeCat)
      : null

  const articleKey = a => `${a.catKey}:${a.q}`

  return (
    <div style={{ maxWidth:820, margin:'0 auto', padding:'24px 20px 64px', fontFamily:'inherit' }}>

      {/* Hero — studio banner with the heading + search overlaid */}
      <div style={{ position:'relative', borderRadius:18, overflow:'hidden', marginBottom:26,
        backgroundImage:'url(/help-studio.jpg)', backgroundSize:'cover', backgroundPosition:'center 38%' }}>
        {/* darkening gradient so text stays readable on any part of the photo */}
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(180deg, rgba(10,8,14,.45) 0%, rgba(10,8,14,.55) 45%, rgba(10,8,14,.82) 100%)' }}/>
        <div style={{ position:'relative', textAlign:'center', padding:'48px 20px 28px' }}>
          <h1 style={{ margin:0, fontSize:28, fontWeight:800, letterSpacing:'-.5px', color:'#fff',
            textShadow:'0 2px 14px rgba(0,0,0,.4)' }}>How can we help?</h1>
          <p style={{ margin:'8px 0 0', fontSize:13.5, color:'rgba(255,255,255,.82)' }}>Search the knowledge base or browse by topic.</p>

          {/* Search */}
          <div style={{ position:'relative', maxWidth:520, margin:'22px auto 0' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#9aa" strokeWidth={2} strokeLinecap="round"
              style={{ position:'absolute', left:15, top:'50%', transform:'translateY(-50%)' }}>
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(null) }}
              placeholder="Search for answers…"
              style={{ width:'100%', height:48, padding:'0 16px 0 42px', borderRadius:12,
                border:'1px solid rgba(255,255,255,.18)', background:'rgba(20,16,24,.72)', color:'#fff',
                fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box',
                boxShadow:'0 8px 28px rgba(0,0,0,.35)', backdropFilter:'blur(6px)' }}
              onFocus={e => e.currentTarget.style.borderColor = C.coral}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,.18)'}
            />
          </div>
        </div>
      </div>

      {/* Browse mode: category cards */}
      {!results && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(210px, 1fr))', gap:12 }}>
          {CATEGORIES.map(cat => (
            <button key={cat.key} onClick={() => { setCat(cat.key); setOpen(null) }}
              style={{ display:'flex', alignItems:'center', gap:13, padding:'16px', borderRadius:14,
                border:`1px solid ${C.border}`, background:'var(--surface)', cursor:'pointer', textAlign:'left',
                fontFamily:'inherit', transition:'background .12s, border-color .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.04)'; e.currentTarget.style.borderColor='rgba(var(--fg),.16)' }}
              onMouseLeave={e => { e.currentTarget.style.background='var(--surface)'; e.currentTarget.style.borderColor=C.border }}>
              <div style={{ width:38, height:38, borderRadius:11, flexShrink:0, background:`${C.coral}12`,
                display:'flex', alignItems:'center', justifyContent:'center' }}>
                <cat.Icon size={19} color={C.coral} weight="duotone" />
              </div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:700, color:C.t1, letterSpacing:'-.1px' }}>{cat.name}</div>
                <div style={{ fontSize:12, color:C.t3, marginTop:2 }}>{cat.articles.length} article{cat.articles.length!==1?'s':''}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Results / category view: article accordion */}
      {results && (
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <span style={{ fontSize:12.5, fontWeight:600, color:C.t3 }}>
              {q ? `${results.length} result${results.length!==1?'s':''} for “${query}”`
                 : CATEGORIES.find(c => c.key === activeCat)?.name}
            </span>
            <button onClick={() => { setQuery(''); setCat(null); setOpen(null) }}
              style={{ fontSize:12.5, fontWeight:600, color:C.coral, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}>
              ← All topics
            </button>
          </div>

          {results.length === 0 ? (
            <div style={{ padding:'48px 20px', textAlign:'center' }}>
              <p style={{ margin:0, fontSize:13.5, fontWeight:600, color:C.t2 }}>No articles found</p>
              <p style={{ margin:'4px 0 0', fontSize:12.5, color:C.t3 }}>Try a different search, or email us at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a>.</p>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column' }}>
              {results.map(a => {
                const k = articleKey(a); const isOpen = open === k
                return (
                  <div key={k} style={{ borderBottom:`1px solid var(--border-2)` }}>
                    <button onClick={() => setOpen(isOpen ? null : k)}
                      style={{ display:'flex', alignItems:'center', gap:12, width:'100%', padding:'14px 6px',
                        background:'none', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                      <span style={{ flex:1, fontSize:13.5, fontWeight:600, color:C.t1 }}>{a.q}</span>
                      {q && <span style={{ fontSize:10.5, fontWeight:700, color:C.t3, background:'rgba(var(--fg),.06)', padding:'2px 7px', borderRadius:20, flexShrink:0 }}>{a.cat}</span>}
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                        style={{ flexShrink:0, transform: isOpen ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    {isOpen && (
                      <p style={{ margin:'0 6px 16px', fontSize:13, lineHeight:1.65, color:C.t2 }}>{a.a}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer links */}
      <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:'4px 18px', marginTop:36,
        paddingTop:20, borderTop:`1px solid ${C.border}` }}>
        {[['Terms of Service','/terms'],['Privacy Policy','/privacy'],['Cookie Policy','/cookies']].map(([label, path]) => (
          <button key={path} onClick={() => navigate(path)}
            style={{ fontSize:12, fontWeight:500, color:C.t3, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color=C.t1}
            onMouseLeave={e => e.currentTarget.style.color=C.t3}>
            {label}
          </button>
        ))}
        <a href="mailto:team@dizko.ai" style={{ fontSize:12, fontWeight:500, color:C.t3, textDecoration:'none' }}
          onMouseEnter={e => e.currentTarget.style.color=C.t1}
          onMouseLeave={e => e.currentTarget.style.color=C.t3}>
          Contact support
        </a>
      </div>
    </div>
  )
}
