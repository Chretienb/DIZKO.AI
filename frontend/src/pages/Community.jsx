import { useNavigate } from 'react-router-dom'
import { DiscoverProducers, ReelsRow } from '../PublicProfile.jsx'

// Full-page producer directory — every public dizko profile in one place,
// not squeezed into the small "Discover" lane at the bottom of your own
// profile. Reuses the same data/cards as that lane (DiscoverProducers,
// ReelsRow) so results stay consistent between the two surfaces.
export default function PageCommunity() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-.4px' }}>Community</div>
        <div style={{ fontSize: 14, color: 'var(--t3)', marginTop: 6 }}>Every producer on dizko, all in one place.</div>
      </div>

      <DiscoverProducers layout="grid" bare navigate={(path) => { navigate(path); window.scrollTo(0, 0) }} />
      <ReelsRow onOpen={(h) => { navigate(`/u/${h}`); window.scrollTo(0, 0) }} />
    </div>
  )
}
