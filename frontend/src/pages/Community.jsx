import { useNavigate } from 'react-router-dom'
import { DiscoverProducers, ReelsRow } from '../PublicProfile.jsx'
import bannerImg from '../assets/marketing/daw-controller.jpg'

// Full-page producer directory — every public dizko profile in one place,
// not squeezed into the small "Discover" lane at the bottom of your own
// profile. Reuses the same data/cards as that lane (DiscoverProducers,
// ReelsRow) so results stay consistent between the two surfaces.
export default function PageCommunity() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ position:'relative', borderRadius:'var(--r-3)', overflow:'hidden', marginBottom: 28,
        border:'1px solid var(--border)', boxShadow:'var(--shadow-1)', height: 160 }}>
        <div style={{ position:'absolute', inset:0, background:`#000 center 32%/cover no-repeat url(${bannerImg})` }}/>
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(100deg, rgba(13,13,15,.92) 0%, rgba(13,13,15,.55) 48%, rgba(109,90,230,.2) 100%)' }}/>
        <div style={{ position:'relative', height:'100%', display:'flex', flexDirection:'column', justifyContent:'center', padding:'0 28px' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-.4px' }}>Community</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.72)', marginTop: 6 }}>Every producer on dizko, all in one place.</div>
        </div>
      </div>

      <DiscoverProducers layout="grid" bare navigate={(path) => { navigate(path); window.scrollTo(0, 0) }} />
      <ReelsRow onOpen={(h) => { navigate(`/u/${h}`); window.scrollTo(0, 0) }} />
    </div>
  )
}
