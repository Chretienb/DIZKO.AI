// Seeded demo producer profiles — so the public/social layer feels alive and a
// newcomer can browse other artists, hear beats, and "get" what Dizko is before
// anyone real has signed up. These render entirely client-side (no DB), play
// real royalty-free audio, and are clearly marked as demo on the profile page.
const S = (n) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`

// A single official Dizko profile seeds the social layer so a newcomer can hear
// beats and "get" what Dizko is before anyone real signs up. Verified + clearly
// our brand. Renders client-side (no DB); the beats are royalty-free audio.
export const DEMO_PROFILES = [
  {
    handle: 'dizko', display_name: 'Dizko Official', avatar_url: '/logo.png', demo: true, verified: true,
    bio: 'The home for producers 🎧\nMake music together, showcase your best, get discovered.\nDrop a beat — tag us to get featured.',
    follower_count: 10, following_count: 1,
    links: ['instagram.com/getdizko', 'https://discord.com/invite/JBapQY8DtE'],
    items: [
      { id: 'd-dizko-1', title: 'Deep Nights (House)', instrument: 'synth', bpm: 124, musical_key: 'A min', play_count: 18400, like_count: 1320, comment_count: 2, caption: 'made in Dizko — remix it, tag us 🔁', audio: S(1),
        demoComments: [
          { id: 'dc-1', author: 'Producer', timestamp_sec: 16, text: 'that drop at 0:16 🔥', created_at: new Date().toISOString() },
          { id: 'dc-2', author: 'Dizko',    timestamp_sec: 0,  text: 'welcome to the community 🎧', created_at: new Date().toISOString() },
        ] },
      { id: 'd-dizko-2', title: 'Sunset Groove', instrument: 'keys',  bpm: 122, musical_key: 'F maj', play_count: 9600, like_count: 740, caption: 'warm house keys for your next set ☀️', audio: S(6) },
      { id: 'd-dizko-3', title: 'Warehouse',     instrument: 'drums', bpm: 126, musical_key: 'G min', play_count: 6100, like_count: 480, caption: 'peak-time energy — free to flip', audio: S(11) },
    ],
  },
]

export const getDemoProfile = (handle) =>
  DEMO_PROFILES.find(p => p.handle === String(handle || '').toLowerCase())

export const isDemoHandle = (handle) => !!getDemoProfile(handle)

// Build the public-profile payload shape from a demo record (matches the API).
export const demoToProfile = (d) => ({
  id: `demo:${d.handle}`,
  handle: d.handle,
  display_name: d.display_name,
  bio: d.bio,
  avatar_url: d.avatar_url,
  links: d.links || [],
  follower_count: d.follower_count,
  following_count: d.following_count,
  is_following: false,
  is_self: false,
  demo: true,
  verified: !!d.verified,
  items: d.items.map(i => ({ ...i, liked: false, stream_url: null })),
})
