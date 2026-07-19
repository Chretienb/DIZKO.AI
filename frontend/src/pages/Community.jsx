import { useNavigate } from 'react-router-dom'
import { Compass } from '@phosphor-icons/react'
import { DiscoverProducers, ReelsRow } from '../PublicProfile.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import bannerImg from '../assets/marketing/daw-controller.jpg'

// Full-page creator directory — every public dizko profile in one place,
// not squeezed into the small "Discover" lane at the bottom of your own
// profile. Reuses the same data/cards as that lane (DiscoverProducers,
// ReelsRow) so results stay consistent between the two surfaces; this file
// only owns the page-level chrome around them.
export default function PageCommunity() {
  const navigate = useNavigate()
  const go = (path) => { navigate(path); window.scrollTo(0, 0) }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', position: 'relative' }}>
      {/* Ambient wash, same language as the Dashboard hero/rail glows */}
      <div aria-hidden="true" style={{ position: 'absolute', top: -40, left: '10%', right: '10%', height: 300,
        background: 'radial-gradient(60% 100% at 50% 0%, var(--brand-tint) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0 }}/>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Hero banner */}
        <div style={{ position:'relative', borderRadius:'var(--r-3)', overflow:'hidden', marginBottom: 36,
          border:'1px solid var(--border)', boxShadow:'var(--shadow-2)', height: 200 }}>
          <div style={{ position:'absolute', inset:0, background:`#000 center 32%/cover no-repeat url(${bannerImg})` }}/>
          <div style={{ position:'absolute', inset:0,
            background:'linear-gradient(100deg, rgba(13,13,15,.94) 0%, rgba(13,13,15,.6) 46%, rgba(109,90,230,.22) 100%)' }}/>
          <div style={{ position:'relative', height:'100%', display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 32px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <Compass size={15} weight="bold" style={{ color:'var(--brand)' }}/>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, fontWeight:500, letterSpacing:'.16em',
                textTransform:'uppercase', color:'var(--brand)' }}>Community</span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-.8px', color: '#fff' }}>Find your next collaborator</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.68)', marginTop: 8, maxWidth: 440, lineHeight: 1.5 }}>
              Every creator on dizko, browsable in one place — follow their work, drop a comment, or slide into their DMs.
            </div>
          </div>
        </div>

        {/* Browse */}
        <SectionHeader eyebrow="Browse" title="All creators" style={{ marginBottom: 16 }}/>
        <DiscoverProducers layout="grid" bare hideLabel navigate={go}/>

        <div style={{ height:1, background:'var(--border)', margin:'40px 0 32px' }}/>

        {/* Fresh sounds — ReelsRow renders its own header, matching styling */}
        <ReelsRow onOpen={(h) => go(`/u/${h}`)}/>
      </div>
    </div>
  )
}
