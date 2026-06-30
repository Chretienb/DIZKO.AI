// Seeded demo producer profiles — so the public/social layer feels alive and a
// newcomer can browse other artists, hear beats, and "get" what Dizko is before
// anyone real has signed up. These render entirely client-side (no DB), play
// real royalty-free audio, and are clearly marked as demo on the profile page.
const A = (n) => `https://i.pravatar.cc/240?img=${n}`
const S = (n) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`

export const DEMO_PROFILES = [
  {
    handle: 'lunawaves', display_name: 'Luna Waves', avatar_url: A(47), demo: true,
    bio: 'LA · lo-fi & R&B 🌙\nopen to collabs — DM me',
    follower_count: 12800, following_count: 312,
    links: ['instagram.com/lunawaves', 'soundcloud.com/lunawaves'],
    items: [
      { id: 'd-luna-1', title: 'Midnight Drive',   instrument: 'keys',  bpm: 90,  musical_key: 'A min', play_count: 24100, like_count: 1840, comment_count: 3, caption: 'made this at 3am 🌌', audio: S(1),
        demoComments: [
          { id: 'dc-1', author: 'Kev',  timestamp_sec: 12, text: 'that pad at 0:12 is insane 🔥', created_at: new Date().toISOString() },
          { id: 'dc-2', author: 'Mari', timestamp_sec: 41, text: 'the switch here! need this for a project', created_at: new Date().toISOString() },
          { id: 'dc-3', author: 'Echo Dept.', timestamp_sec: 0, text: 'dreamy. would love to add strings.', created_at: new Date().toISOString() },
        ] },
      { id: 'd-luna-2', title: 'Velvet',            instrument: 'vocals',bpm: 84,  musical_key: 'F maj', play_count: 9800,  like_count: 740,  caption: '', audio: S(2) },
      { id: 'd-luna-3', title: 'Slow Burn',         instrument: 'bass',  bpm: 76,  musical_key: 'D min', play_count: 6200,  like_count: 410,  caption: 'looking for a vocalist on this one', audio: S(3) },
    ],
  },
  {
    handle: '808kev', display_name: 'Kev', avatar_url: A(12), demo: true,
    bio: 'ATL trap producer · 808s for days\nbeats: $50 lease / $300 excl.',
    follower_count: 43200, following_count: 88,
    links: ['instagram.com/808kev'],
    items: [
      { id: 'd-kev-1', title: 'Drip Theory',  instrument: 'drums', bpm: 140, musical_key: 'G min', play_count: 88400, like_count: 6120, caption: 'who wants this 🔥', audio: S(4) },
      { id: 'd-kev-2', title: 'No Cap',        instrument: 'bass',  bpm: 145, musical_key: 'C min', play_count: 51200, like_count: 3980, caption: '', audio: S(5) },
    ],
  },
  {
    handle: 'marisound', display_name: 'Mari', avatar_url: A(32), demo: true,
    bio: 'house & afrobeats 🌍 London\nlet’s make something',
    follower_count: 7600, following_count: 540,
    links: ['soundcloud.com/marisound'],
    items: [
      { id: 'd-mari-1', title: 'Sunrise (Dub)', instrument: 'synth', bpm: 122, musical_key: 'A min', play_count: 15300, like_count: 1120, caption: 'summer ☀️', audio: S(6) },
      { id: 'd-mari-2', title: 'Lagos Nights',  instrument: 'drums', bpm: 110, musical_key: 'E min', play_count: 9100,  like_count: 690,  caption: '', audio: S(7) },
      { id: 'd-mari-3', title: 'Float',         instrument: 'keys',  bpm: 124, musical_key: 'D maj', play_count: 4400,  like_count: 280,  caption: 'wip — feedback welcome', audio: S(8) },
    ],
  },
  {
    handle: 'echodept', display_name: 'Echo Dept.', avatar_url: A(60), demo: true,
    bio: 'ambient / cinematic · scoring & sync\nremote sessions worldwide',
    follower_count: 3300, following_count: 210,
    links: ['echodept.com'],
    items: [
      { id: 'd-echo-1', title: 'Glass Cathedral', instrument: 'synth', bpm: 70, musical_key: 'C maj', play_count: 5600, like_count: 470, caption: 'for a short film 🎬', audio: S(9) },
      { id: 'd-echo-2', title: 'Northern',         instrument: 'keys',  bpm: 68, musical_key: 'G maj', play_count: 3100, like_count: 250, caption: '', audio: S(10) },
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
  items: d.items.map(i => ({ ...i, liked: false, stream_url: null })),
})
