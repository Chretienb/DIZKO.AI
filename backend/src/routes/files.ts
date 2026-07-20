import { Hono }         from 'hono'
import { supabase }     from '../lib/supabase'
import { uploadToR2, deleteFromR2, getR2SignedUrl, getR2PresignedPutUrl, r2ObjectExists, r2KeyFromUrl,
  createMultipartUpload, getR2PresignedPartUrl, listMultipartParts, completeMultipartUpload, abortMultipartUpload } from '../lib/r2'
import { requireAuth }  from '../middleware/auth'
import { rateLimit }    from '../middleware/rateLimit'
import { sanitize }     from '../middleware/sanitize'
import { startStemSeparation, pollStemSeparation } from '../lib/stemSeparation'
import { analyzeWavBuffer, extractWaveformPeaks, getWavDurationSec } from '../lib/audioAnalysis'
import { validateManualBpm, mergeBpmIntoNotes } from '../lib/stemNotes'
import { transcodeToPlaybackAsset, decodeToWav, playbackKeyFor, PLAYBACK_CONTENT_TYPE } from '../lib/transcode'
import { submitForAiDetection } from '../lib/aiDetect'
import { classifyInstrument } from '../lib/instrumentTagging'
import { getUsersByIds } from '../lib/users'
import { roleCanUpload, instrumentToRoleHint, assertProjectAccess, projectIdForStem, isProjectOwner, songScopeFor } from '../lib/rbac'
import { notify, getProjectMemberIds } from '../lib/notificationService'
import { canUploadStem, remainingStemSlots, freeTierLimitReached, getCreatorEntitlement, FREE_STEM_LIMIT } from '../lib/entitlement'
import { withProjectLock } from '../lib/projectLock'
import type { HonoVariables } from '../types'

const files = new Hono<{ Variables: HonoVariables }>()
files.use('*', requireAuth)

// Per-user caps on the cost-bearing endpoints (mounted after requireAuth, so
// the window keys on user id). Uploads fan out to AI naming + audio analysis;
// stem separation calls Replicate (the most expensive op).
const uploadLimit    = rateLimit({ max: 60, windowMs: 60_000, keyBy: 'user' })
const replicateLimit = rateLimit({ max: 8,  windowMs: 60_000, keyBy: 'user' })

const MAX_FILE_BYTES = 500 * 1024 * 1024 // 500 MB hard server limit

const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', aif: 'audio/aiff', aiff: 'audio/aiff',
  flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'audio/mp4', wma: 'audio/x-ms-wma', opus: 'audio/opus', zip: 'application/zip',
}

function resolveContentType(filename: string, browserType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? browserType ?? 'application/octet-stream'
}

// ── Detect instrument type from filename (no AI needed) ───────────────────────
// Strip filename noise (producer tags, @handles, BPM, brackets) BEFORE detecting,
// so junk like "[Prod. …]" doesn't make every stem read as Drums (the "prod" trap).
function cleanForDetect(filename: string): string {
  return filename.toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')   // [Prod...] (12)
    .replace(/@\S+/g, ' ')                    // @seventhbeats
    .replace(/\b\d{1,3}\s?bpm\b/g, ' ')       // 103bpm
    .replace(/\bprod(uced)?\b\.?/g, ' ')      // Prod.
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s{2,}/g, ' ').trim()
}

// ── Authoritative stem spec (dizko_stem_naming_logic) ────────────────────────
// One ordered table drives BOTH the instrument badge/grouping (`instr`, a
// canonical value the GROUPS map to Master/Vocals/Melody/Bass/Drums/FX/Other) AND
// the display name's stem TYPE (`label`). Order = priority — compound/specific
// keywords first so e.g. "808 kick" → Kick (drums), bare "808" → 808 (bass), and
// instrument words beat ambiguous role words ("Guitar hook" → Guitar, not vox).
export const STEM_SPEC: { instr: string; label: string; re: RegExp }[] = [
  // Master (strong, unambiguous indicators only)
  { instr:'master', label:'Master', re:/\b(master|mastered|mixdown|full ?mix|stereo ?mix|2 ?mix|two ?mix|final ?mix|rough ?mix|instrumental|album ?version|radio ?edit|bounce|export|current)\b/ },
  // Drums / percussion — compounds first
  { instr:'kick',       label:'Kick',   re:/\b(808 ?kick|sub ?kick|bass ?drum|kick|kik|bd|kd)\b/ },
  { instr:'snare',      label:'Snare',  re:/\b(snare|snr|sn|sd|rimshot|rim|side ?stick|clap|claps|clp|handclap|reverbclap)\b/ },
  { instr:'openhat',    label:'OpenHat',re:/\b(open ?hat|openhh|half ?open|oh)\b/ },
  { instr:'hihat',      label:'HiHat',  re:/\b(hi ?-?hat|hats?|hh|ch|closed ?hat|pedal ?hat|trap ?hat)\b/ },
  { instr:'cymbal',     label:'Cymbal', re:/\b(cymbal|ride|crash|splash|china|sizzle|overhead)\b/ },
  { instr:'percussion', label:'Perc',   re:/\b(perc|percussion|shaker|tambourine|tamb|conga|bongo|timbale|cowbell|woodblock|claves|cabasa|maracas|triangle|djembe|cajon|snap|stomp)\b/ },
  { instr:'drums',      label:'Drums',  re:/\b(drums?|drum ?loop|breakbeat|break|amen|full ?kit|kit ?loop|live ?drums|groove|tr-?808|tr-?909|drum ?machine|mpc|sp404|metal|drumroll|beat)\b/ },
  // Bass
  { instr:'808',  label:'808',  re:/\b808\b/ },
  { instr:'bass', label:'Bass', re:/\b(bass|bs|sub ?bass|subbass|sub|low ?end|bass ?line|reese|synth ?bass|growl ?bass|wobble|acid ?bass|tb-?303|live ?bass|electric ?bass|bass ?guitar|slap ?bass|upright ?bass|double ?bass|fretless|deep ?bass|sine ?bass|rumble)\b/ },
  // Melody
  { instr:'keys',    label:'Keys',    re:/\b(keys?|piano|pno|rhodes|wurli|wurlitzer|clav|clavinet|electric ?piano|ep|grand ?piano|upright|keyboard|kb|kbd|organ|hammond|b3|leslie|drawbar)\b/ },
  { instr:'bells',   label:'Bells',   re:/\b(marimba|xylophone|vibraphone|vibes?|glockenspiel|glock|bells?|chimes?|tubular ?bells|steel ?drum|kalimba|celeste|celesta)\b/ },
  { instr:'pad',     label:'Pad',     re:/\b(pad|atmosphere|atmo|ambient|texture|wash|lush|evolving|drone|sustained|swell|warm ?pad|cold ?pad|dark ?pad)\b/ },
  { instr:'arp',     label:'Arp',     re:/\b(arp|arpeggio|arpeggiated|sequence|seq|riff|gated ?synth|gate)\b/ },
  { instr:'lead',    label:'Lead',    re:/\b(lead|synth ?lead|ld|mono ?lead|main ?synth|top ?synth|synth ?line|analog ?lead|pluck|stab|saw ?lead|square ?lead|melody)\b/ },
  { instr:'guitar',  label:'Guitar',  re:/\b(guitar|gtr|git|acoustic|ac ?guitar|elec ?guitar|electric ?guitar|strat|tele|les ?paul|sg|clean ?guitar|distorted|overdrive|crunch|rhythm ?guitar|lead ?guitar|fingerpicked|strummed|nylon|12 ?string|slide|banjo|mandolin|ukulele|uke)\b/ },
  { instr:'strings', label:'Strings', re:/\b(strings?|violin|violon|viola|cello|fiddle|orchestral|orch|string ?section|pizzicato|pizz|bowed|chamber ?strings|live ?strings|harp)\b/ },
  { instr:'brass',   label:'Brass',   re:/\b(horns?|brass|trumpet|trombone|sax|saxophone|flute|french ?horn|tuba|horn ?section|alto ?sax|tenor ?sax|bari ?sax|flugelhorn|clarinet|oboe)\b/ },
  { instr:'synth',   label:'Synth',   re:/\b(synth|serum|nexus|massive|sylenth|omnisphere|kontakt|juno|moog|triton|pigments|vital|diva|prophet|analog ?lab|analog|wavetable)\b/ },
  // Vocals (after instruments)
  { instr:'harmony', label:'Harmony', re:/\b(harmony|harmonies|bgv|bg ?vox|background ?vocal|backing|adlib|ad ?lib|doubles|dbl|double|bv|back ?vox|bg|support ?vox|oohs|aahs|stack|chant|choir)\b/ },
  { instr:'vocals',  label:'Vocals',  re:/\b(vocals?|vox|voc|topline|top ?line|voice|main ?vox|main ?vocal|singer|sung|dry ?vox|wet ?vox|processed ?vox|rap|verse|bars|feature|feat|hook|bridge|pre-?chorus|prechorus|outro|intro ?vox|spoken|talk ?box|vocoder|talkbox|lyric|acapella|acappella|tags?|chops?|runs|takes?)\b/ },
  // FX
  { instr:'fx', label:'FX', re:/\b(fx|effect|sfx|transition|riser|build|buildup|drop|downlifter|uplifter|sweep|swoosh|whoosh|rush|fall|reverse|spin|rewind|foley|noise|static|glitch|stutter|distortion ?fx|bitcrush|lo-?fi|vinyl|crackle|tape|siren|air ?horn|alarm|crowd|room ?tone|white ?noise|pink ?noise)\b/ },
  // Other (explicit)
  { instr:'recording', label:'Recording', re:/\b(recording|new ?recording|misc|extra|temp|draft|wip|test|untitled|audio|sample|unknown)\b/ },
]

function detectInstrument(filename: string): string {
  const n = cleanForDetect(filename)
  for (const s of STEM_SPEC) if (s.re.test(n)) return s.instr
  return 'recording'
}

// BPM + key analysis now handled by pure TypeScript audioAnalysis.ts

const detectLimit = rateLimit({ max: 120, windowMs: 60_000, keyBy: 'user' })

// ── POST /files/detect ─────────────────────────────────────────────────────────
// Classify a stem's instrument from its AUDIO *before* upload, so the upload
// modal can show the real instrument (not the filename guess). Stages the file
// to a temp R2 path, asks the PANNs worker, then deletes the temp object.
// Returns { instrument, confidence } — or null data if the worker is off/unsure
// (frontend keeps its filename guess in that case).
files.post('/detect', detectLimit, async (c) => {
  const user = c.var.user

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }
  const file = formData.get('file') as File | null
  if (!file) return c.json({ data: null, error: 'file is required', status: 400 }, 400)
  if (file.size > MAX_FILE_BYTES) return c.json({ data: null, error: 'File too large', status: 413 }, 413)

  const contentType = resolveContentType(file.name, file.type)
  const buffer = Buffer.from(await file.arrayBuffer())
  const tmpPath = `tmp-detect/${user.id}/${Date.now()}_${file.name}`

  try {
    await uploadToR2(tmpPath, buffer, contentType)
    const url = await getR2SignedUrl(tmpPath)
    const tag = await classifyInstrument(url)   // { instrument, confidence } | null
    return c.json({ data: tag, error: null, status: 200 }, 200)
  } catch (e) {
    return c.json({ data: null, error: (e as Error).message, status: 500 }, 500)
  } finally {
    deleteFromR2(tmpPath).catch(() => {})       // never leave temp objects around
  }
})

// ── POST /files/upload ─────────────────────────────────────────────────────────
// Accepts any audio file, saves it to the session, analyzes BPM/key,
// then triggers a Smart Mix update. Stem separation is NOT automatic.
files.post('/upload', uploadLimit, async (c) => {
  const user = c.var.user

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }

  const file           = formData.get('file') as File | null
  const projectId      = formData.get('project_id') as string | null
  const instrumentHint = (formData.get('instrument') as string | null)?.trim() || null
  const analysisRaw    = (formData.get('analysis') as string | null) || null

  // Parse Essentia analysis sent from the browser (real audio features)
  let essentiaAnalysis: {
    bpm?: number; key?: string; scale?: string;
    loudness?: number; brightness?: number; danceability?: number;
    zcr?: number; duration?: number;
  } | null = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}

  if (!file || !projectId) {
    return c.json({ data: null, error: 'file and project_id are required', status: 400 }, 400)
  }

  if (file.size > MAX_FILE_BYTES) {
    return c.json({ data: null, error: 'File exceeds 500 MB limit', status: 413 }, 413)
  }

  const contentType = resolveContentType(file.name, file.type)
  const buffer = Buffer.from(await file.arrayBuffer())

  // 1. Check storage limit
  const { data: profile } = await supabase
    .from('profiles')
    .select('storage_used_bytes, storage_limit_bytes, subscription_status')
    .eq('id', user.id)
    .single()

  const p = profile as any
  if (p && (p.storage_used_bytes + file.size) > p.storage_limit_bytes) {
    return c.json({
      data: null,
      error: 'Storage limit reached — upgrade your plan to upload more',
      storage_used:  p.storage_used_bytes,
      storage_limit: p.storage_limit_bytes,
      status: 403,
    }, 403)
  }

  // 1b. Free-tier stem cap (15/project, owner-keyed — paid plans bypass)
  const stemCheck = await canUploadStem(projectId)
  if (!stemCheck.allowed) return c.json(freeTierLimitReached(stemCheck), 402)

  // 2. Upload to Cloudflare R2
  const storagePath = `takes/${user.id}/${projectId}/${Date.now()}_${file.name}`
  try {
    await uploadToR2(storagePath, buffer, contentType)
  } catch (e) {
    return c.json({ data: null, error: 'Storage upload failed', status: 500 }, 500)
  }
  const fileUrl = await getR2SignedUrl(storagePath)

  // Increment storage counter (non-blocking — billing/status heals drift anyway)
  ;(async () => {
    const { error: rpcErr } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: file.size })
    if (rpcErr) console.error('[upload] increment_storage rpc error (run 006_storage_rpc.sql migration):', rpcErr.message)
  })()

  // 3. Resolve or create track
  const { data: existingTrack } = await supabase
    .from('tracks').select('id').eq('project_id', projectId)
    .order('position', { ascending: true }).limit(1).maybeSingle()

  let trackId = (existingTrack as { id: string } | null)?.id
  if (!trackId) {
    const { data: newTrack, error: trackErr } = await supabase
      .from('tracks').insert({ project_id: projectId, title: file.name, position: 1 }).select('id').single()
    if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    trackId = (newTrack as { id: string }).id
  }

  // 3. Use instrument from frontend if provided, otherwise detect from filename
  const instrument = instrumentHint || detectInstrument(file.name)

  // 3b. Role-based access check — owner bypasses, collaborators restricted by role
  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', projectId).single()
  const isOwner = (project as any)?.owner_id === user.id

  if (!isOwner) {
    const { data: collab } = await supabase
      .from('collaborators').select('role, status')
      .eq('project_id', projectId).eq('user_id', user.id).maybeSingle()

    if (!collab || (collab as any).status !== 'active') {
      return c.json({ data: null, error: 'You are not a collaborator on this project', status: 403 }, 403)
    }

    const role = (collab as any).role ?? 'Collaborator'
    if (!roleCanUpload(role, instrument)) {
      // Return 403 with flag so frontend shows "Request Access"
      return c.json({
        data: null,
        error: `Your role (${role}) can't upload ${instrument} files`,
        needs_request: true,
        instrument,
        role,
        hint: `Request access from the project owner to upload ${instrument}`,
        status: 403,
      }, 403)
    }
  }

  // 4. Insert the take record immediately (status: ready — no processing needed)
  const { data: takeRecord, error: takeErr } = await supabase
    .from('stems')
    .insert({
      track_id:       trackId,
      original_name:  file.name,
      suggested_name: file.name,
      file_url:       fileUrl,
      storage_path:   storagePath,
      file_size:      file.size,
      mime_type:      contentType,
      instrument,
      notes:          JSON.stringify({ status: 'analyzing', type: 'take' }),
      uploaded_by:    user.id,
    })
    .select().single()

  if (takeErr) return c.json({ data: null, error: takeErr.message, status: 500 }, 500)
  const takeId = (takeRecord as { id: string }).id

  // 5. Analyze BPM/key in background, then trigger Smart Mix update
  ;(async () => {
    try {
      // Use Essentia data from browser if available — it's more accurate.
      // Fall back to backend WAV analysis only if Essentia didn't run.
      let bpm: number | null = essentiaAnalysis?.bpm ?? null
      let key: string | null = essentiaAnalysis?.key
        ? `${essentiaAnalysis.key} ${essentiaAnalysis.scale ?? ''}`.trim()
        : null

      if (!bpm || !key) {
        const fallback = await analyzeWavBuffer(buffer).catch(() => ({ bpm: null, key: null }))
        bpm = bpm ?? fallback.bpm
        key = key ?? fallback.key
      }

      // Project title (the "song") + owner (the "artist") for structured naming.
      const { data: proj } = await supabase.from('projects').select('title, owner_id').eq('id', projectId).single()
      const projectTitle = (proj as any)?.title ?? undefined
      const ownerId = (proj as any)?.owner_id as string | undefined
      let artist: string | undefined
      if (ownerId) {
        const owner = (await getUsersByIds([ownerId]).catch(() => null))?.get(ownerId)
        artist = owner?.full_name || owner?.email?.split('@')[0] || undefined
      }

      // Content-based instrument fallback: if the user didn't pick an instrument,
      // ask the CLAP worker what it actually is from the audio. No-op until the
      // worker is configured (CLAP_SERVICE_URL). Overrides the filename guess only
      // when confident, and persists it so naming + Smart Mix use the real label.
      let resolvedInstrument = instrument
      if (!instrumentHint) {
        const tagged = await classifyInstrument(fileUrl).catch(() => null)
        if (tagged && tagged.confidence >= 0.30) {
          resolvedInstrument = tagged.instrument
          const { error: instErr } = await supabase.from('stems').update({ instrument: tagged.instrument }).eq('id', takeId)
          if (instErr) console.warn('[clap] instrument update failed:', instErr.message)
          console.log(`[clap] ${file.name} → ${tagged.instrument} (${tagged.confidence})`)
        }
      }

      // Build name — Artist_Song_Key_BPM_StemName
      const suggestedName = await buildSuggestedName(
        file.name, resolvedInstrument, bpm, key, projectTitle, artist
      )

      // Extract waveform peaks from WAV buffer — stored so frontend renders
      // instantly from DB instead of fetching from R2 on every page load.
      const isWavUpload = contentType === 'audio/wav' || file.name.endsWith('.wav')
      const peaks = isWavUpload ? extractWaveformPeaks(buffer) : null
      // Duration lands in audio_features.duration — the field the frontend's
      // getStemDurationSec reads. Without it, every Studio open probes each
      // stem's metadata over the network before the timeline can lay out.
      const wavDurationSec = isWavUpload ? getWavDurationSec(buffer) : null
      const audioFeatures = {
        ...((essentiaAnalysis as Record<string, unknown>) || {}),
        ...(wavDurationSec && !(essentiaAnalysis as any)?.duration ? { duration: wavDurationSec } : {}),
      }

      await supabase.from('stems').update({
        notes: JSON.stringify({
          status: 'ready', type: 'take', bpm, key,
          ...(Object.keys(audioFeatures).length ? { audio_features: audioFeatures } : {}),
          ...(peaks                             ? { peaks }                          : {}),
        }),
        suggested_name: suggestedName,
      }).eq('id', takeId)

      console.log(`[upload] ${file.name} → "${suggestedName}" (${bpm ?? 'n/a'} BPM · ${key ?? 'n/a'}${peaks ? ` · ${peaks.length} peaks` : ''})`)

      // No auto-mix — mixing happens only when the user clicks "Generate Mix".
    } catch (e) {
      console.error('[upload] background analysis error:', (e as Error).message)
    }
  })()

  return c.json({
    data: {
      id:        takeId,
      status:    'ready',
      instrument,
      message:   'Added to session — AI is analyzing and updating the mix',
    },
    error: null,
    status: 201,
  }, 201)
})

// ── Direct-to-R2 upload (presign + register) ────────────────────────────────
// The legacy /upload above routes the whole file browser→backend→R2, which
// timed out on big multi-stem drops (839MB through the backend). These two
// endpoints let the BROWSER PUT straight to R2: /upload-url runs the access
// checks and hands back a presigned PUT URL; /register records the metadata
// (tiny + instant, so the stem shows up immediately) and kicks the same
// background analysis. Requires the R2 bucket to allow CORS PUT from the app.

// Shared access gate — returns null if allowed, or a JSON error body to return.
async function uploadGate(userId: string, projectId: string, instrument: string, size: number) {
  const { data: profile } = await supabase
    .from('profiles').select('storage_used_bytes, storage_limit_bytes').eq('id', userId).single()
  const p = profile as any
  if (p && (p.storage_used_bytes + size) > p.storage_limit_bytes) {
    return { status: 403 as const, body: { data: null, error: 'Storage limit reached — upgrade your plan to upload more', storage_used: p.storage_used_bytes, storage_limit: p.storage_limit_bytes, status: 403 } }
  }
  const stemCheck = await canUploadStem(projectId)
  if (!stemCheck.allowed) {
    const body = freeTierLimitReached(stemCheck)
    return { status: 402 as const, body }
  }
  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', projectId).single()
  if ((project as any)?.owner_id === userId) return null   // owner bypasses
  const { data: collab } = await supabase
    .from('collaborators').select('role, status').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (!collab || (collab as any).status !== 'active') {
    return { status: 403 as const, body: { data: null, error: 'You are not a collaborator on this project', status: 403 } }
  }
  const role = (collab as any).role ?? 'Collaborator'
  if (!roleCanUpload(role, instrument)) {
    return { status: 403 as const, body: { data: null, error: `Your role (${role}) can't upload ${instrument} files`, needs_request: true, instrument, role, hint: `Request access from the project owner to upload ${instrument}`, status: 403 } }
  }
  return null
}

// Background BPM/key/naming/WAV-peaks/Smart-Mix for a stem whose bytes are in R2.
// Fetches the object back from R2 (server→R2, never blocks the user) only when
// the bytes are needed (fallback analysis or WAV peaks). Sets the row to 'ready'.
function enrichStemInBackground(takeId: string, projectId: string, userId: string, opts: {
  fileUrl: string; fileName: string; contentType: string; instrument: string;
  instrumentHint?: string | null; essentiaAnalysis?: any; recordOffsetMs?: number | null;
}) {
  const { fileUrl, fileName, contentType, instrument, instrumentHint, essentiaAnalysis, recordOffsetMs } = opts
  ;(async () => {
    try {
      let bpm: number | null = essentiaAnalysis?.bpm ?? null
      let key: string | null = essentiaAnalysis?.key ? `${essentiaAnalysis.key} ${essentiaAnalysis.scale ?? ''}`.trim() : null
      const isWav  = contentType === 'audio/wav'  || fileName.endsWith('.wav')
      const isFlac = contentType === 'audio/flac' || fileName.endsWith('.flac')
      // Fetch the bytes — needed for the MP3 preview and (decoded) for peaks/BPM.
      let buffer: Buffer | null = null
      try { const r = await fetch(fileUrl); if (r.ok) buffer = Buffer.from(await r.arrayBuffer()) } catch {}

      // PCM WAV used for analysis: WAV uploads are already PCM; FLAC (or anything
      // else) is decoded to WAV via ffmpeg so BPM/key/peaks still work.
      let pcmWav: Buffer | null = null
      if (buffer) pcmWav = isWav ? buffer : await decodeToWav(buffer).catch(() => null)

      if ((!bpm || !key) && pcmWav) {
        const fb = await analyzeWavBuffer(pcmWav).catch(() => ({ bpm: null, key: null }))
        bpm = bpm ?? fb.bpm; key = key ?? fb.key
      }

      const { data: proj } = await supabase.from('projects').select('title, owner_id').eq('id', projectId).single()
      const projectTitle = (proj as any)?.title ?? undefined
      const ownerId = (proj as any)?.owner_id as string | undefined
      let artist: string | undefined
      if (ownerId) {
        const owner = (await getUsersByIds([ownerId]).catch(() => null))?.get(ownerId)
        artist = owner?.full_name || owner?.email?.split('@')[0] || undefined
      }

      let resolvedInstrument = instrument
      if (!instrumentHint) {
        const tagged = await classifyInstrument(fileUrl).catch(() => null)
        if (tagged && tagged.confidence >= 0.30) {
          resolvedInstrument = tagged.instrument
          await supabase.from('stems').update({ instrument: tagged.instrument }).eq('id', takeId)
        }
      }

      const suggestedName = await buildSuggestedName(fileName, resolvedInstrument, bpm, key, projectTitle, artist)
      const peaks = pcmWav ? extractWaveformPeaks(pcmWav) : null
      // Same as the direct-upload path: persist duration so the Studio can
      // lay out the timeline without a per-stem network metadata probe.
      const wavDurationSec = pcmWav ? getWavDurationSec(pcmWav) : null
      const audioFeatures = {
        ...((essentiaAnalysis as Record<string, unknown>) || {}),
        ...(wavDurationSec && !(essentiaAnalysis as any)?.duration ? { duration: wavDurationSec } : {}),
      }

      // Compressed AAC playback asset for instant playback — the buffer is
      // already in memory, so this costs no extra download. ffmpeg reads WAV
      // or FLAC; we only bother for those big lossless formats (mp3/m4a
      // already stream fine). Stored under the same notes.preview /
      // preview_url the app already fully supports end-to-end — the field
      // was always "the small instant-play asset," never coupled to a
      // specific codec, so no API/frontend field rename was needed to switch
      // from MP3 to AAC here. Best-effort: a failure just means playback
      // falls back to the full file.
      let previewKey: string | null = null
      if (buffer && (isWav || isFlac)) {
        try {
          const aac = await transcodeToPlaybackAsset(buffer)
          previewKey = playbackKeyFor(takeId)
          await uploadToR2(previewKey, aac, PLAYBACK_CONTENT_TYPE)
        } catch (e) {
          previewKey = null
          console.error('[enrich] playback-asset transcode failed:', (e as Error).message)
        }
      }

      // Advisory AI-generated-audio check — fire-and-forget, result arrives
      // later via webhook and never gates readiness (see lib/aiDetect.ts).
      // Any format the upload accepts (WAV/FLAC/MP3/...) — unlike the AAC
      // preview above, ACRCloud's detector isn't limited to lossless masters.
      if (buffer) {
        const aiExt = isWav ? 'wav' : isFlac ? 'flac' : (fileName.split('.').pop() || 'mp3').toLowerCase()
        submitForAiDetection(buffer, takeId, aiExt)
      }

      await supabase.from('stems').update({
        notes: JSON.stringify({
          status: 'ready', type: 'take', bpm, key,
          ...(Object.keys(audioFeatures).length ? { audio_features: audioFeatures } : {}),
          ...(peaks ? { peaks } : {}),
          ...(previewKey ? { preview: previewKey } : {}),
          ...(recordOffsetMs != null ? { record_offset_ms: recordOffsetMs } : {}),
        }),
        suggested_name: suggestedName,
      }).eq('id', takeId)

      console.log(`[enrich] ${fileName} → "${suggestedName}" (${bpm ?? 'n/a'} BPM · ${key ?? 'n/a'}${peaks ? ` · ${peaks.length} peaks` : ''}${previewKey ? ' · preview' : ''})`)
      // No auto-mix — mixing happens only when the user clicks "Generate Mix".
    } catch (e) {
      console.error('[enrich] background analysis error:', (e as Error).message)
    }
  })()
}

// ── "Boom-instant" batch upload ─────────────────────────────────────────────
// /batch-init: ONE call → access-check once, insert all rows as status
// 'uploading', return a presigned PUT URL per file. The rows exist immediately,
// so the project shows every stem the moment the user clicks (no waiting on the
// 839MB to transfer). The browser then PUTs each file to R2 and calls
// /:id/uploaded, which flips the row to 'ready' + kicks the same analysis.
files.post('/batch-init', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { project_id, folder_id, files: items } = body || {}
  if (!project_id || !Array.isArray(items) || items.length === 0) {
    return c.json({ data: null, error: 'project_id and a non-empty files[] are required', status: 400 }, 400)
  }
  if (items.length > 200) return c.json({ data: null, error: 'Too many files in one batch (max 200)', status: 400 }, 400)

  // Storage limit — whole batch at once.
  const totalSize = items.reduce((s: number, f: any) => s + (Number(f.file_size) || 0), 0)
  // The independent reads (storage, owner, first track) run in PARALLEL — keeps
  // batch-init to ~one DB round trip so the stems appear near-instantly.
  const [{ data: profile }, { data: project }, { data: existingTrack }] = await Promise.all([
    supabase.from('profiles').select('storage_used_bytes, storage_limit_bytes').eq('id', user.id).single(),
    supabase.from('projects').select('owner_id, title').eq('id', project_id).single(),
    supabase.from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle(),
  ])
  const projectTitle = (project as any)?.title as string | undefined
  const pf = profile as any
  if (pf && (pf.storage_used_bytes + totalSize) > pf.storage_limit_bytes) {
    return c.json({ data: null, error: 'Storage limit reached — upgrade your plan to upload more', storage_used: pf.storage_used_bytes, storage_limit: pf.storage_limit_bytes, status: 403 }, 403)
  }

  // Resolve the caller's role ONCE (owner bypasses).
  const isOwner = (project as any)?.owner_id === user.id
  let role: string | null = null
  if (!isOwner) {
    const { data: collab } = await supabase.from('collaborators').select('role, status').eq('project_id', project_id).eq('user_id', user.id).maybeSingle()
    if (!collab || (collab as any).status !== 'active') return c.json({ data: null, error: 'You are not a collaborator on this project', status: 403 }, 403)
    role = (collab as any).role ?? 'Collaborator'
  }

  // Resolve/create the track ONCE — locked per-project so this can't race a
  // concurrent /multipart/init (or another batch-init) for the same project
  // and create a duplicate track for what should be one song.
  let trackId: string
  try {
    trackId = await withProjectLock(project_id, async () => {
      if ((existingTrack as any)?.id) return (existingTrack as any).id as string
      const { data: fresh } = await supabase.from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle()
      if (fresh) return (fresh as any).id as string
      const { data: newTrack, error: trackErr } = await supabase.from('tracks').insert({ project_id, title: String(items[0]?.file_name || 'Untitled'), position: 1 }).select('id').single()
      if (trackErr) throw new Error(trackErr.message)
      return (newTrack as { id: string }).id
    })
  } catch (e: any) {
    return c.json({ data: null, error: e?.message || 'Could not resolve track', status: 500 }, 500)
  }

  const blocked: any[] = []
  // 1) Validate + plan (sync) — separate blocked files out.
  const plan: { fileName: string; size: number; instrument: string; contentType: string; storagePath: string }[] = []
  for (const f of items) {
    const fileName = String(f?.file_name || '')
    if (!fileName) continue
    const size = Number(f.file_size) || 0
    if (size > MAX_FILE_BYTES) { blocked.push({ file_name: fileName, error: 'File exceeds 500 MB limit' }); continue }
    const instrument = (f.instrument ? String(f.instrument).trim() : '') || detectInstrument(fileName)
    if (!isOwner && role && !roleCanUpload(role, instrument)) {
      blocked.push({ file_name: fileName, instrument, role, needs_request: true, hint: `Request access to upload ${instrument}` })
      continue
    }
    const contentType = resolveContentType(fileName, f.content_type || '')
    const storagePath = `takes/${user.id}/${project_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName}`
    plan.push({ fileName, size, instrument, contentType, storagePath })
  }

  // Free-tier stem cap: accept the first N files up to the remaining slots,
  // block the overflow — a partial success, matching this route's existing
  // "some succeed, some blocked" philosophy rather than failing the whole batch.
  // The check-then-insert below runs inside the project lock (free tier only —
  // paid owners have no cap to race against) so a batch-init overlapping
  // another batch-init or a /multipart/init for the same project can't both
  // read the same pre-insert count and jointly exceed FREE_STEM_LIMIT.
  const doAccept = async (): Promise<{ stems: any[]; error?: string }> => {
    const { remaining } = await remainingStemSlots(project_id)
    let acceptedPlan = plan
    if (remaining < plan.length) {
      acceptedPlan = plan.slice(0, remaining)
      for (const overflow of plan.slice(remaining)) {
        blocked.push({
          file_name: overflow.fileName,
          error: `Free plan is limited to ${FREE_STEM_LIMIT} stems per project — upgrade for unlimited stems.`,
          code: 'stem_limit',
        })
      }
    }
    if (acceptedPlan.length === 0) return { stems: [] }

    // Sign every PUT + GET URL in PARALLEL (was the batch's slow part when done
    // one-by-one — this is what keeps "appear" near-instant for big drops).
    const signed = await Promise.all(acceptedPlan.map(async pl => ({
      ...pl,
      url:     await getR2PresignedPutUrl(pl.storagePath, pl.contentType),
      fileUrl: await getR2SignedUrl(pl.storagePath),
    })))

    const meta = signed.map(s => ({ url: s.url, storage_path: s.storagePath, content_type: s.contentType, file_name: s.fileName, instrument: s.instrument }))
    const rows = signed.map(s => ({
      // Structured name right away (Track_StemType); enrich appends _Key_BPM later.
      track_id: trackId, original_name: s.fileName, suggested_name: buildSuggestedName(s.fileName, s.instrument, null, null, projectTitle),
      file_url: s.fileUrl, storage_path: s.storagePath, file_size: s.size, mime_type: s.contentType, instrument: s.instrument,
      ...(folder_id ? { folder_id } : {}),
      notes: JSON.stringify({ status: 'uploading', type: 'take' }), uploaded_by: user.id,
    }))

    const { data: inserted, error: insErr } = await supabase.from('stems').insert(rows).select('id, storage_path')
    if (insErr) return { stems: [], error: insErr.message }

    const byPath = new Map<string, string>((inserted as any[]).map(r => [r.storage_path, r.id]))
    const stems = meta
      .map(m => ({ id: byPath.get(m.storage_path), file_name: m.file_name, storage_path: m.storage_path, url: m.url, content_type: m.content_type, instrument: m.instrument }))
      .filter(s => s.id)
    return { stems }
  }

  const paid = await getCreatorEntitlement((project as any)?.owner_id)
  const { stems, error: acceptErr } = paid.entitled ? await doAccept() : await withProjectLock(project_id, doAccept)
  if (acceptErr) return c.json({ data: null, error: acceptErr, status: 500 }, 500)

  return c.json({ data: { track_id: trackId, stems, blocked }, error: null, status: 200 }, 200)
})

// /:id/uploaded — the browser finished PUTting the bytes to R2. Count storage,
// flip the row 'uploading' → 'analyzing', and kick the background enrichment.
files.post('/:id/uploaded', uploadLimit, async (c) => {
  const user = c.var.user
  const id = c.req.param('id')
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const { instrument: instrumentHint, analysis: analysisRaw } = body || {}

  const { data: stem } = await supabase
    .from('stems').select('id, storage_path, original_name, mime_type, instrument, file_url, file_size, uploaded_by')
    .eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const s = stem as any
  // Only the uploader (who got the presigned URL) can complete it.
  if (s.uploaded_by !== user.id) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)

  const projectId = await projectIdForStem(id).catch(() => null)
  if (!projectId) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  // Verify the bytes actually landed before finalizing. A client PUT can error
  // (slow/dropped connection under load) even when R2 got the object — so the
  // uploader calls this regardless, and we only "fail" if the object is truly
  // absent. Prevents false "Upload failed" on a stem that did upload.
  if (!(await r2ObjectExists(s.storage_path).catch(() => false))) {
    return c.json({ data: null, error: 'Upload incomplete — file not in storage', incomplete: true, status: 409 }, 409)
  }

  let essentiaAnalysis: any = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}

  ;(async () => {
    const { error } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: s.file_size || 0 })
    if (error) console.error('[uploaded] increment_storage rpc error:', error.message)
  })()

  const instrument = (instrumentHint ? String(instrumentHint).trim() : '') || s.instrument || detectInstrument(s.original_name)
  await supabase.from('stems').update({
    notes: JSON.stringify({ status: 'analyzing', type: 'take' }),
    ...(instrument !== s.instrument ? { instrument } : {}),
  }).eq('id', id)

  const fileUrl = s.file_url || await getR2SignedUrl(s.storage_path)
  enrichStemInBackground(id, projectId, user.id, { fileUrl, fileName: s.original_name, contentType: s.mime_type, instrument, instrumentHint, essentiaAnalysis })

  return c.json({ data: { id, status: 'ready' }, error: null, status: 201 }, 201)
})

// ── Multipart (resumable) uploads ────────────────────────────────────────────
// For big stems the browser uploads in chunks instead of one all-or-nothing PUT,
// so a refresh/disconnect resumes from the last completed part (seconds) rather
// than restarting the whole file, and parts transfer in parallel. The server
// owns CreateMultipartUpload + Complete (reading ETags from R2 via ListParts), so
// the browser only PUTs part bytes — no ETag/CORS-ExposeHeaders requirement.
const MULTIPART_PART_SIZE = 8 * 1024 * 1024  // 8 MB parts (≥5 MB S3 minimum, except the last)

function readMp(notes: string | null): { uploadId?: string; partSize?: number; partCount?: number } {
  try { return JSON.parse(notes || '{}').mp || {} } catch { return {} }
}

// /multipart/init — one large file. Access-check + create the stem row + open a
// multipart upload; the browser then PUTs each part and calls /multipart/complete.
files.post('/multipart/init', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { project_id, folder_id, file_name, file_size, content_type, instrument: instrumentHint } = body || {}
  if (!project_id || !file_name) return c.json({ data: null, error: 'project_id and file_name are required', status: 400 }, 400)
  const size = Number(file_size) || 0
  if (size > MAX_FILE_BYTES) return c.json({ data: null, error: 'File exceeds 500 MB limit', status: 413 }, 413)

  const [{ data: profile }, { data: project }, { data: existingTrack }] = await Promise.all([
    supabase.from('profiles').select('storage_used_bytes, storage_limit_bytes').eq('id', user.id).single(),
    supabase.from('projects').select('owner_id, title').eq('id', project_id).single(),
    supabase.from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle(),
  ])
  if (!project) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)
  const projectTitle = (project as any)?.title as string | undefined
  const pf = profile as any
  if (pf && (pf.storage_used_bytes + size) > pf.storage_limit_bytes) {
    return c.json({ data: null, error: 'Storage limit reached — upgrade your plan to upload more', status: 403 }, 403)
  }

  const isOwner = (project as any)?.owner_id === user.id
  const instrument = (instrumentHint ? String(instrumentHint).trim() : '') || detectInstrument(String(file_name))
  if (!isOwner) {
    const { data: collab } = await supabase.from('collaborators').select('role, status').eq('project_id', project_id).eq('user_id', user.id).maybeSingle()
    if (!collab || (collab as any).status !== 'active') return c.json({ data: null, error: 'You are not a collaborator on this project', status: 403 }, 403)
    const role = (collab as any).role ?? 'Collaborator'
    if (!roleCanUpload(role, instrument)) return c.json({ data: null, error: `Request access to upload ${instrument}`, needs_request: true, status: 403 }, 403)
  }

  // Track resolution is ALWAYS serialized per-project (a cheap read, occasional
  // insert) — otherwise many large files landing in parallel on a brand-new
  // project/song can each see "no track yet" before any of them has created
  // one, and each creates its own, fragmenting one song into several.
  let trackId: string
  try {
    trackId = await withProjectLock(project_id, async () => {
      if ((existingTrack as any)?.id) return (existingTrack as any).id as string
      const { data: fresh } = await supabase.from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle()
      if (fresh) return (fresh as any).id as string
      const { data: newTrack, error: trackErr } = await supabase.from('tracks').insert({ project_id, title: String(file_name), position: 1 }).select('id').single()
      if (trackErr) throw new Error(trackErr.message)
      return (newTrack as { id: string }).id
    })
  } catch (e: any) {
    return c.json({ data: null, error: e?.message || 'Could not resolve track', status: 500 }, 500)
  }

  const contentType = resolveContentType(String(file_name), content_type || '')
  const storagePath = `takes/${user.id}/${project_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file_name}`
  const partSize = MULTIPART_PART_SIZE
  const partCount = Math.max(1, Math.ceil(size / partSize))
  const fileUrl = await getR2SignedUrl(storagePath)

  // Opens the R2 multipart upload + inserts the stem row. Free-tier callers run
  // this INSIDE the project lock (see below) so the stem-cap check and the
  // insert that follows it are one atomic unit — otherwise many of these firing
  // in parallel (one per large file in a batch drop) can all pass the check
  // before any of them has inserted a row, blowing past FREE_STEM_LIMIT.
  const doInit = async (): Promise<{ id: string; uploadId: string } | { error: string }> => {
    let uploadId: string
    try { uploadId = await createMultipartUpload(storagePath, contentType) }
    catch (e: any) { return { error: e?.message || 'Could not start multipart upload' } }
    const { data: inserted, error: insErr } = await supabase.from('stems').insert({
      track_id: trackId, original_name: String(file_name),
      suggested_name: buildSuggestedName(String(file_name), instrument, null, null, projectTitle),
      file_url: fileUrl, storage_path: storagePath, file_size: size, mime_type: contentType, instrument,
      ...(folder_id ? { folder_id } : {}),
      notes: JSON.stringify({ status: 'uploading', type: 'take', mp: { uploadId, partSize, partCount } }), uploaded_by: user.id,
    }).select('id').single()
    if (insErr) { await abortMultipartUpload(storagePath, uploadId); return { error: insErr.message } }
    return { id: (inserted as any).id, uploadId }
  }

  const paid = await getCreatorEntitlement((project as any).owner_id)
  const result = paid.entitled
    ? await doInit()
    : await withProjectLock(project_id, async () => {
        const stemCheck = await canUploadStem(project_id)
        if (!stemCheck.allowed) return { blocked: stemCheck } as const
        return await doInit()
      })

  if ('blocked' in result) return c.json(freeTierLimitReached(result.blocked), 402)
  if ('error' in result)   return c.json({ data: null, error: result.error, status: 500 }, 500)

  return c.json({ data: {
    id: result.id, storage_path: storagePath, upload_id: result.uploadId,
    part_size: partSize, part_count: partCount, content_type: contentType, instrument,
  }, error: null, status: 200 }, 200)
})

// /:id/multipart/part-urls — fresh presigned PUT URLs for the requested parts
// (re-signable after expiry / for resume), plus which parts R2 already has so the
// client can skip them.
files.post('/:id/multipart/part-urls', uploadLimit, async (c) => {
  const user = c.var.user
  const id = c.req.param('id')
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const { data: stem } = await supabase.from('stems').select('storage_path, mime_type, uploaded_by, notes').eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const s = stem as any
  if (s.uploaded_by !== user.id) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  const mp = readMp(s.notes)
  if (!mp.uploadId) return c.json({ data: null, error: 'Not a multipart upload', status: 409 }, 409)

  const want: number[] = Array.isArray(body?.part_numbers) && body.part_numbers.length
    ? body.part_numbers.map((n: any) => Number(n)).filter((n: number) => n >= 1)
    : Array.from({ length: mp.partCount || 0 }, (_, i) => i + 1)

  const [done, urlPairs] = await Promise.all([
    listMultipartParts(s.storage_path, mp.uploadId).then(p => p.map(x => x.PartNumber)).catch(() => [] as number[]),
    Promise.all(want.map(async n => [n, await getR2PresignedPartUrl(s.storage_path, mp.uploadId!, n)] as const)),
  ])
  return c.json({ data: { urls: Object.fromEntries(urlPairs), done }, error: null, status: 200 }, 200)
})

// /:id/multipart/complete — every part is in R2; assemble the object and finalize
// exactly like /:id/uploaded (verify, count storage, → analyzing, enrich). If
// parts are still missing, 409 with the done-list so the client fills the gaps.
files.post('/:id/multipart/complete', uploadLimit, async (c) => {
  const user = c.var.user
  const id = c.req.param('id')
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const { instrument: instrumentHint, analysis: analysisRaw } = body || {}

  const { data: stem } = await supabase.from('stems').select('id, storage_path, original_name, mime_type, instrument, file_url, file_size, uploaded_by, notes').eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const s = stem as any
  if (s.uploaded_by !== user.id) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)

  // Already finalized by a concurrent/earlier call — treat as success (idempotent).
  let curStatus = 'uploading'; try { curStatus = JSON.parse(s.notes || '{}').status } catch {}
  if (curStatus !== 'uploading' && curStatus !== 'failed') return c.json({ data: { id, status: 'ready' }, error: null, status: 200 }, 200)

  const mp = readMp(s.notes)
  if (!mp.uploadId) return c.json({ data: null, error: 'Not a multipart upload', status: 409 }, 409)

  const projectId = await projectIdForStem(id).catch(() => null)
  if (!projectId) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  const parts = await listMultipartParts(s.storage_path, mp.uploadId).catch(() => [])
  if (parts.length < (mp.partCount || 0)) {
    return c.json({ data: { done: parts.map(p => p.PartNumber) }, error: 'Upload incomplete — parts missing', incomplete: true, status: 409 }, 409)
  }

  try { await completeMultipartUpload(s.storage_path, mp.uploadId, parts) }
  catch (e: any) {
    // A late part or transient R2 error — let the client retry (still not 'failed').
    return c.json({ data: { done: parts.map(p => p.PartNumber) }, error: e?.message || 'Could not complete upload', incomplete: true, status: 409 }, 409)
  }

  if (!(await r2ObjectExists(s.storage_path).catch(() => false))) {
    return c.json({ data: null, error: 'Upload incomplete — file not in storage', incomplete: true, status: 409 }, 409)
  }

  let essentiaAnalysis: any = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}
  ;(async () => {
    const { error } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: s.file_size || 0 })
    if (error) console.error('[multipart/complete] increment_storage rpc error:', error.message)
  })()

  const instrument = (instrumentHint ? String(instrumentHint).trim() : '') || s.instrument || detectInstrument(s.original_name)
  await supabase.from('stems').update({
    notes: JSON.stringify({ status: 'analyzing', type: 'take' }),
    ...(instrument !== s.instrument ? { instrument } : {}),
  }).eq('id', id)

  const fileUrl = s.file_url || await getR2SignedUrl(s.storage_path)
  enrichStemInBackground(id, projectId, user.id, { fileUrl, fileName: s.original_name, contentType: s.mime_type, instrument, instrumentHint, essentiaAnalysis })

  return c.json({ data: { id, status: 'ready' }, error: null, status: 201 }, 201)
})

// /reconcile — heal stems left 'uploading' when a direct upload was abandoned
// (tab refreshed/closed mid-upload). For each of the caller's 'uploading' stems
// in the project: if the bytes are actually in R2, recover it (→ analyzing +
// enrich); if not and it's been a while, mark it 'failed'.
files.post('/reconcile', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { project_id } = body || {}
  if (!project_id) return c.json({ data: null, error: 'project_id is required', status: 400 }, 400)

  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', project_id).single()
  const isOwner = (project as any)?.owner_id === user.id
  if (!isOwner) {
    const { data: collab } = await supabase.from('collaborators').select('status').eq('project_id', project_id).eq('user_id', user.id).maybeSingle()
    if (!collab || (collab as any).status !== 'active') return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  }

  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', project_id)
  const trackIds = (tracks as any[] || []).map(t => t.id)
  if (trackIds.length === 0) return c.json({ data: { recovered: 0, failed: 0 }, error: null, status: 200 }, 200)

  const { data: stems } = await supabase
    .from('stems').select('id, storage_path, original_name, mime_type, instrument, file_url, created_at, notes')
    .in('track_id', trackIds).eq('uploaded_by', user.id)

  // Recover-only: any 'uploading' OR (falsely) 'failed' stem whose bytes are
  // actually in R2 → flip to ready + enrich. We never mark failed here — that
  // would wrongly fail slow in-progress PUTs (R2 has no object until the PUT
  // completes). Genuine failure is decided by /:id/uploaded (verifies R2).
  let recovered = 0
  await Promise.all((stems as any[] || []).map(async s => {
    let status = 'ready'
    try { status = JSON.parse(s.notes || '{}').status } catch {}
    if (status !== 'uploading' && status !== 'failed') return
    if (await r2ObjectExists(s.storage_path).catch(() => false)) {
      const instrument = s.instrument || detectInstrument(s.original_name)
      await supabase.from('stems').update({ notes: JSON.stringify({ status: 'analyzing', type: 'take' }) }).eq('id', s.id)
      const fileUrl = s.file_url || await getR2SignedUrl(s.storage_path)
      enrichStemInBackground(s.id, project_id, user.id, { fileUrl, fileName: s.original_name, contentType: s.mime_type, instrument, instrumentHint: instrument })
      recovered++
    }
  }))

  return c.json({ data: { recovered, failed: 0 }, error: null, status: 200 }, 200)
})

// Fresh presigned PUT URL for an existing 'uploading' stem — lets the background
// uploader resume a PUT after the original URL (1h) expired.
files.post('/:id/put-url', uploadLimit, async (c) => {
  const user = c.var.user
  const id = c.req.param('id')
  const { data: stem } = await supabase.from('stems').select('storage_path, mime_type, uploaded_by').eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const s = stem as any
  if (s.uploaded_by !== user.id) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  const url = await getR2PresignedPutUrl(s.storage_path, s.mime_type || 'application/octet-stream')
  return c.json({ data: { url }, error: null, status: 200 }, 200)
})

files.post('/upload-url', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { file_name, content_type, file_size, project_id, instrument: instrumentHint } = body || {}
  if (!file_name || !project_id) return c.json({ data: null, error: 'file_name and project_id are required', status: 400 }, 400)
  const size = Number(file_size) || 0
  if (size > MAX_FILE_BYTES) return c.json({ data: null, error: 'File exceeds 500 MB limit', status: 413 }, 413)

  const instrument = (instrumentHint as string)?.trim() || detectInstrument(file_name)
  const gate = await uploadGate(user.id, project_id, instrument, size)
  if (gate) return c.json(gate.body, gate.status)

  const contentType = resolveContentType(file_name, content_type || '')
  const storagePath = `takes/${user.id}/${project_id}/${Date.now()}_${file_name}`
  const url = await getR2PresignedPutUrl(storagePath, contentType)
  return c.json({ data: { url, storage_path: storagePath, content_type: contentType }, error: null, status: 200 }, 200)
})

files.post('/register', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { storage_path, project_id, file_name, file_size, content_type, instrument: instrumentHint, analysis: analysisRaw, record_offset_ms } = body || {}
  if (!storage_path || !project_id || !file_name) return c.json({ data: null, error: 'storage_path, project_id and file_name are required', status: 400 }, 400)
  // Only accept paths we'd have signed for this user — stops registering arbitrary keys.
  if (!storage_path.startsWith(`takes/${user.id}/${project_id}/`)) {
    return c.json({ data: null, error: 'Invalid storage_path', status: 400 }, 400)
  }

  const size = Number(file_size) || 0
  const contentType = resolveContentType(file_name, content_type || '')
  const instrument = (instrumentHint as string)?.trim() || detectInstrument(file_name)
  const gate = await uploadGate(user.id, project_id, instrument, size)
  if (gate) return c.json(gate.body, gate.status)

  let essentiaAnalysis: any = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}

  const fileUrl = await getR2SignedUrl(storage_path)

  ;(async () => {
    const { error: rpcErr } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: size })
    if (rpcErr) console.error('[register] increment_storage rpc error:', rpcErr.message)
  })()

  const { data: existingTrack } = await supabase
    .from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle()
  let trackId = (existingTrack as { id: string } | null)?.id
  if (!trackId) {
    const { data: newTrack, error: trackErr } = await supabase
      .from('tracks').insert({ project_id, title: file_name, position: 1 }).select('id').single()
    if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    trackId = (newTrack as { id: string }).id
  }

  // Recording captures sample-accurately from wherever the transport was when
  // Record was pressed (see Studio.jsx's startPcmCapture) — the WAV itself has
  // no silence padding, so the resulting clip must start at that same position
  // or it plays from 0:00 like every other stem, defeating the point of
  // recording mid-song. Carried through notes (not a dedicated column) since
  // it's only relevant once, at auto-placement — see the realtime INSERT
  // handler in Studio.jsx that reads it back out.
  const recordOffsetMs = Number.isFinite(record_offset_ms) && record_offset_ms >= 0 ? Math.round(record_offset_ms) : null

  const { data: takeRecord, error: takeErr } = await supabase
    .from('stems')
    .insert({
      track_id: trackId, original_name: file_name, suggested_name: file_name,
      file_url: fileUrl, storage_path, file_size: size, mime_type: contentType, instrument,
      notes: JSON.stringify({ status: 'analyzing', type: 'take', ...(recordOffsetMs != null ? { record_offset_ms: recordOffsetMs } : {}) }),
      uploaded_by: user.id,
    })
    .select().single()
  if (takeErr) return c.json({ data: null, error: takeErr.message, status: 500 }, 500)
  const takeId = (takeRecord as { id: string }).id

  enrichStemInBackground(takeId, project_id, user.id, { fileUrl, fileName: file_name, contentType, instrument, instrumentHint, essentiaAnalysis, recordOffsetMs })

  // Let the rest of the crew know a stem landed — in-app + email. Deduped on the
  // project (5-min window), so uploading a whole folder is a single notification.
  ;(async () => {
    try {
      const memberIds = await getProjectMemberIds(project_id)
      if (memberIds.length <= 1) return   // solo project — nobody to tell
      const uploader = (await getUsersByIds([user.id]).catch(() => null))?.get(user.id)
      const who = uploader?.full_name || uploader?.email?.split('@')[0] || 'A collaborator'
      const { data: proj } = await supabase.from('projects').select('title').eq('id', project_id).single()
      const projTitle = (proj as { title?: string } | null)?.title || 'your project'
      await notify({
        type:         'upload',
        recipientIds: memberIds,
        actorId:      user.id,
        projectId:    project_id,
        title:        'New stem uploaded',
        body:         `${who} added a new stem to “${projTitle}”.`,
        actionUrl:    `/projects/${project_id}`,
      })
    } catch (e) { console.error('[register] upload notify failed:', (e as Error).message) }
  })()

  return c.json({
    data: { id: takeId, status: 'ready', instrument, message: 'Added — AI is analyzing and updating the mix' },
    error: null, status: 201,
  }, 201)
})

// Clean StemType label from the instrument id (the "type" in the studio name).
const STEM_TYPE_LABEL: Record<string, string> = {
  vocals: 'Vocals', drums: 'Drums', kick: 'Kick', snare: 'Snare', hihat: 'HiHat',
  cymbal: 'Cymbal', percussion: 'Perc', bass: 'Bass', guitar: 'Guitar',
  acoustic: 'Acoustic', piano: 'Piano', keys: 'Keys', organ: 'Organ',
  synth: 'Synth', pad: 'Pad', strings: 'Strings', brass: 'Brass', wind: 'Wind',
  harmony: 'Harmony', master: 'Master', demo: 'Demo', recording: 'Recording',
}

// Specific stem words that may appear in a filename → a clean type label. Lets
// us keep DETAIL (snare vs generic drums, 808 vs generic bass) while still
// applying the [SONG]_[TYPE]_[KEY]_[BPM] convention around it. Order matters:
// more specific words win (checked top-to-bottom).
const FILENAME_STEM_WORDS: [RegExp, string][] = [
  [/\bmaster\b/i, 'Master'],
  // Vocals + abbreviations
  [/\b(adlib|ad-lib)\b/i, 'Adlib'], [/\bharmon\w*/i, 'Harmony'],
  [/\b(bgv|bgvs|bvs?|backing|backups?)\b/i, 'BGV'], [/\b(choir|chant)\b/i, 'Choir'],
  [/\b(vocals?|vox|vocal)\b/i, 'Vocals'],
  // Bass
  [/\b808\b/i, '808'], [/\bsub\b/i, 'Sub'], [/\bbass\b/i, 'Bass'],
  // Drums + percussion
  [/\bsnare\b/i, 'Snare'], [/\b(kick|kik)\b/i, 'Kick'], [/\b(open ?hat|open-?hat|\boh\b)\b/i, 'OpenHat'],
  [/\b(hi-?hat|hats?|\bhh\b)\b/i, 'HiHat'], [/\bclap\b/i, 'Clap'], [/\b(tom|toms)\b/i, 'Tom'],
  [/\b(cymbal|ride|crash|splash)\b/i, 'Cymbal'], [/\b(rim|rimshot)\b/i, 'Rim'],
  [/\b(conga|congas)\b/i, 'Conga'], [/\b(bongo|bongos)\b/i, 'Bongo'], [/\b(shaker|shkr|shake)\b/i, 'Shaker'],
  [/\b(tambourine|tamb)\b/i, 'Tambourine'], [/\bcowbell\b/i, 'Cowbell'], [/\b(djembe|cajon|udu)\b/i, 'Percussion'],
  [/\b(clave|claves|woodblock|triangle)\b/i, 'Percussion'], [/\bperc\w*/i, 'Perc'], [/\bdrums?\b/i, 'Drums'],
  // Guitar / plucked
  [/\bacoustic\b/i, 'Acoustic'], [/\b(gtr|guitar)s?\b/i, 'Guitar'],
  [/\bbanjo\b/i, 'Banjo'], [/\bmandolin\b/i, 'Mandolin'], [/\b(ukulele|uke)\b/i, 'Ukulele'],
  // Keys
  [/\b(piano|rhodes|wurli|clav)\b/i, 'Piano'], [/\borgan\b/i, 'Organ'],
  [/\b(accordion|harmonica)\b/i, 'Accordion'], [/\bkeys?\b/i, 'Keys'],
  // Synth (sources / popular plugins all map to Synth)
  [/\b(serum|nexus|massive|sylenth|omnisphere|kontakt|juno|moog|triton|pigments|vital|diva|prophet|analog ?lab|nexus2)\b/i, 'Synth'],
  [/\bsynth\b/i, 'Synth'], [/\bpad\b/i, 'Pad'], [/\bbells?\b/i, 'Bells'], [/\b(pluck|stab)\b/i, 'Pluck'],
  // Strings / orchestral
  [/\b(violin|violon|vln|fiddle)\b/i, 'Violin'], [/\bviola\b/i, 'Viola'], [/\b(cello|vc)\b/i, 'Cello'],
  [/\bharp\b/i, 'Harp'], [/\bstrings?\b/i, 'Strings'],
  // Brass / wind
  [/\b(trumpet|tpt)\b/i, 'Trumpet'], [/\b(trombone|tbn)\b/i, 'Trombone'],
  [/\b(brass|horns?)\b/i, 'Brass'], [/\b(sax|saxophone)\b/i, 'Sax'],
  [/\b(flute|clarinet|oboe|wind)\b/i, 'Wind'],
  // Melodic roles
  [/\blead\b/i, 'Lead'], [/\bmelody\b/i, 'Melody'], [/\barp\b/i, 'Arp'], [/\bhook\b/i, 'Hook'],
  // FX / sound design
  [/\b(riser|uplifter|downlifter|sweep|swoosh|whoosh|impact|drone|atmos|foley|transition|noise|texture)\b/i, 'FX'],
]
function stemTypeFromFilename(base: string): string | null {
  // Normalize separators to spaces so \b word boundaries fire (underscores are
  // word chars). Same STEM_SPEC table that drives the instrument badge, so the
  // display TYPE and the grouping always agree.
  const norm = base.replace(/[_\-.]+/g, ' ')
  for (const s of STEM_SPEC) if (s.re.test(norm)) return s.label
  return null
}

// Last resort: when nothing is recognized, pull the most DESCRIPTIVE word out of
// a (usually noisy) filename so the stem gets a real name — e.g.
// "Angel da Vinci - CAMERAS_Siren" → "Siren" — instead of the generic "Recording".
const NAME_NOISE = /\b(prod|produced|by|the|and|for|with|final|mastered?|mix(?:down|ed)?|bounce|export|stem|stems|track|takes?|loops?|samples?|packs?|kits?|presets?|vol|version|ft|feat|featuring|official|tag|tagged|extreme|analog|lab|african|producer|bundle|seventhbeats|free|wet|dry|main|full|new|old)\b/gi
function meaningfulWordFromFilename(base: string): string | null {
  const s = base
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')             // [Prod...] (12)
    .replace(/@\S+/g, ' ')                              // @seventhbeats
    .replace(/\b\d{1,3}\s?bpm\b/gi, ' ')                // 103bpm
    .replace(/\b\d{4}[-_]\d{2}[-_]\d{2}\S*/g, ' ')      // dates
    .replace(/[#&/]+/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/\b\d+\b/g, ' ')                           // bare numbers
    .replace(/\s{2,}/g, ' ').trim()
  const tokens = s.split(' ').filter(t => /[a-z]/i.test(t) && t.length >= 2)
  // The descriptor is usually the LAST surviving token (after a song/producer prefix).
  const w = tokens[tokens.length - 1]
  if (!w) return null
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
}

// Canonical instrument values that carry no descriptive detail — when the
// instrument field is one of these, prefer the filename over the bare label.
const GENERIC_INSTR = new Set(['recording', 'other', ''])

// Structured, organized studio name: SONG_StemType_Key_BPM
//   e.g. "TWIN_Bass_Am_102". The convention is ALWAYS applied — we never bail out
//   to the raw filename just because it contains a stem word (that's what made
//   uploads keep names like "bass_final" instead of the convention). The stem type
//   prefers a specific word found in the filename (snare/808/lead) over the generic
//   instrument label so detail isn't lost. Missing key/bpm segments are omitted.
export function buildSuggestedName(
  original: string,
  instrument: string,
  bpm: number | null,
  key: string | null,
  projectTitle?: string,
  _artist?: string,
): string {
  const base = original.replace(/\.[^.]+$/, '')

  // Filename-safe segment (keep # for sharp keys, strip everything else).
  const seg = (s?: string | null) => (s ?? '').replace(/[^A-Za-z0-9#]+/g, '')
  // Compact key: "F# minor" → "F#min", "C major" → "Cmaj".
  const fmtKey = (k?: string | null) =>
    (k ?? '').replace(/\bmajor\b/i, 'maj').replace(/\bminor\b/i, 'min').replace(/[^A-Za-z0-9#]+/g, '')

  // Studio.jsx's own in-app recordings are always named "Recording_<ISO
  // timestamp>.wav" — pure machine-generated text, never anything
  // descriptive. Fed through meaningfulWordFromFilename anyway, its last
  // surviving "word" ended up being a shredded fragment of the timestamp
  // (millisecond digits + the trailing "Z" utc marker, e.g. "927z") because
  // that filter only requires ONE letter in a token, not MOSTLY letters —
  // reported live as stems named things like "in_927z_D#_165". A real
  // instrument tag (picked before recording, or set later) already skips
  // this branch entirely via the instrument check below; this only guards
  // the "skipped tagging" fallback path.
  const isAutoRecordingFilename = /^Recording_\d{4}-\d{2}-\d{2}T/i.test(base)

  // Stem type, in priority order:
  //   1. a specific instrument word/abbreviation found in the filename
  //   2. the detected instrument's label — but ONLY if it actually carries detail
  //      (a generic "recording"/"other" is skipped so we don't print "Recording")
  //   3. the most descriptive word pulled from the filename (skipped for the
  //      Studio's own auto-named recordings — see isAutoRecordingFilename)
  //   4. last resort: "Recording"
  const instr = (instrument || '').toLowerCase()
  const stemType = stemTypeFromFilename(base)
    || (GENERIC_INSTR.has(instr) ? null : (STEM_TYPE_LABEL[instr] || (instrument.charAt(0).toUpperCase() + instrument.slice(1))))
    || (isAutoRecordingFilename ? null : meaningfulWordFromFilename(base))
    || 'Recording'

  const parts = [
    seg(projectTitle),                       // SONG
    seg(stemType),                           // STEM TYPE
    fmtKey(key),                             // KEY
    bpm ? String(Math.round(bpm)) : '',      // BPM
  ].filter(Boolean)

  // Always returns the convention; falls back to the tidied filename only if we
  // somehow have no song/type/key/bpm at all.
  return parts.join('_') || base.replace(/\s+/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '')
}

// ── POST /files/:id/separate-stems ────────────────────────────────────────────
// User-triggered stem separation via Replicate's hosted Demucs GPU.
// Passes the file's public URL directly — no local download needed.
files.post('/:id/separate-stems', replicateLimit, async (c) => {
  const user   = c.var.user
  const takeId = c.req.param('id')

  const { data: take, error: fetchErr } = await supabase
    .from('stems').select('*').eq('id', takeId).single()

  if (fetchErr || !take) return c.json({ data: null, error: 'Take not found', status: 404 }, 404)

  const t     = take as any
  const notes = JSON.parse(t.notes || '{}')
  const bpm   = notes.bpm ?? null
  const key   = notes.key ?? null

  const { data: track } = await supabase.from('tracks').select('project_id').eq('id', t.track_id).single()
  const projectId = (track as any)?.project_id

  // Only project members may run (expensive) stem separation
  if (!projectId || !(await assertProjectAccess(projectId, user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  // Mark as separating
  await supabase.from('stems').update({
    notes: JSON.stringify({ ...notes, separating: true }),
  }).eq('id', takeId)

  // Kick off Replicate prediction — passes the public Supabase URL directly (no local download)
  const predictionId = await startStemSeparation(t.file_url)
  if (!predictionId) {
    await supabase.from('stems').update({
      notes: JSON.stringify({ ...notes, error: 'Failed to start Replicate prediction' }),
    }).eq('id', takeId)
    return c.json({ data: null, error: 'Failed to start stem separation', status: 500 }, 500)
  }

  // Poll Replicate in the background — onComplete fires when GPU is done (~30–90 s)
  pollStemSeparation(predictionId, async (stemUrls) => {
    const stemTypes = ['vocals', 'drums', 'bass', 'other'] as const
    let count = 0

    for (const type of stemTypes) {
      const url = stemUrls[type]
      if (!url) continue
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const buf         = Buffer.from(await res.arrayBuffer())
        const filename    = `${type}_${takeId}.wav`
        const storagePath = `stems/${user.id}/${projectId}/${filename}`

        try {
          await uploadToR2(storagePath, buf, 'audio/wav')
        } catch (e) {
          console.error(`[replicate] upload failed for ${type}:`, (e as Error).message)
          continue
        }
        const publicUrl = await getR2SignedUrl(storagePath)
        const suggestedName = [
          type.charAt(0).toUpperCase() + type.slice(1),
          bpm ? `${Math.round(bpm)} BPM` : null,
          key  ? key : null,
        ].filter(Boolean).join(' · ')

        const { data: inserted } = await supabase.from('stems').insert({
          track_id:       t.track_id,
          original_name:  filename,
          suggested_name: suggestedName,
          file_url:       publicUrl,
          storage_path:   storagePath,
          file_size:      buf.length,
          mime_type:      'audio/wav',
          instrument:     type,
          notes:          JSON.stringify({ parent_stem_id: takeId, stem_type: type, bpm, key }),
          uploaded_by:    user.id,
        }).select('id').single()
        // Demucs children never went through enrichStemInBackground, so they
        // were never submitted for AI-generated-audio detection either —
        // fire it here too, same fire-and-forget/advisory-only contract.
        const newStemId = (inserted as any)?.id
        if (newStemId) submitForAiDetection(buf, newStemId, 'wav')
        ;(async () => {
          const { error: rpcErr } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: buf.length })
          if (rpcErr) console.error('[stems] increment_storage rpc error:', rpcErr.message)
        })()
        count++
      } catch (e) {
        console.error(`[replicate] error processing ${type}:`, (e as Error).message)
      }
    }

    await supabase.from('stems').update({
      notes: JSON.stringify({ status: 'ready', type: 'take', bpm, key, separated: true, stem_count: count }),
    }).eq('id', takeId)
  })

  return c.json({
    data: { id: takeId, status: 'separating', message: 'Stem separation started' },
    error: null,
    status: 202,
  }, 202)
})

// ── GET /files/:id ─────────────────────────────────────────────────────────────
files.get('/:id', async (c) => {
  const { data, error } = await supabase
    .from('stems')
    .select(`*, tracks(id, name, project_id, projects(id, title))`)
    .eq('id', c.req.param('id'))
    .single()

  if (error) return c.json({ data: null, error: 'File not found', status: 404 }, 404)

  const stem = data as any
  // Only members of the stem's project may read it (and get a signed URL) —
  // and a song-scoped collaborator only members of THEIR songs, same as the
  // list endpoint. Without this check a stem id from outside their scope
  // (however the client came to hold it) could still be fetched directly.
  const projectId = stem?.tracks?.project_id
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const scope = await songScopeFor(projectId, c.var.user.id)
  if (scope && !(stem.folder_id && scope.includes(stem.folder_id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  if (stem?.storage_path) stem.file_url = await getR2SignedUrl(stem.storage_path)

  return c.json({ data: stem, error: null, status: 200 })
})

// ── PATCH /files/:id ───────────────────────────────────────────────────────────
files.patch('/:id', sanitize, async (c) => {
  const allowed = ['suggested_name', 'original_name', 'instrument', 'notes', 'mime_type'] as const
  const body    = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  for (const key of allowed) { if (key in body) updates[key] = body[key] }

  // Manual BPM override — bpm lives inside the `notes` JSON blob, not its own
  // column, so merge it in rather than letting the client overwrite the whole
  // blob (that would risk clobbering peaks/audio_features it doesn't know about).
  if ('bpm' in body) {
    const validated = validateManualBpm(body.bpm)
    if (!validated.ok) return c.json({ data: null, error: validated.error, status: 400 }, 400)

    const { data: current } = await supabase.from('stems').select('notes').eq('id', c.req.param('id')).single()
    updates.notes = mergeBpmIntoNotes((current as any)?.notes, validated.bpm)
  }

  if (Object.keys(updates).length === 0)
    return c.json({ data: null, error: 'No updatable fields provided', status: 400 }, 400)

  // Only the project owner or the stem's uploader may edit its details —
  // collaborators can upload and comment, not rename/re-tag others' stems
  // (Angel's permissions note).
  const projectId = await projectIdForStem(c.req.param('id'))
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)
  const { data: stemRow } = await supabase.from('stems').select('uploaded_by').eq('id', c.req.param('id')).single()
  const canEdit = (stemRow as any)?.uploaded_by === c.var.user.id || (await isProjectOwner(projectId, c.var.user.id))
  if (!canEdit)
    return c.json({ data: null, error: 'Only the owner or the uploader can edit this stem', status: 403 }, 403)

  // Don't set updated_at — the stems table may not have that column (a DB
  // trigger handles it where present). Setting it unconditionally made every
  // rename/tag PATCH 500, which the client swallowed → edits never saved.
  const { data, error } = await supabase
    .from('stems').update(updates).eq('id', c.req.param('id')).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /files/:id ──────────────────────────────────────────────────────────
files.delete('/:id', async (c) => {
  const userId    = c.var.user.id
  const projectId = await projectIdForStem(c.req.param('id'))
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: stem, error: fetchErr } = await supabase
    .from('stems').select('storage_path, file_size, uploaded_by, instrument, notes').eq('id', c.req.param('id')).single()

  if (fetchErr) return c.json({ data: null, error: 'File not found', status: 404 }, 404)

  const s = stem as { storage_path: string; file_size: number; uploaded_by: string; instrument: string; notes: string | null } | null

  // Permission: you can delete your OWN stems; the owner can delete anything.
  // The master + Smart Mix versions are owner-only (they're the deliverables).
  const owner       = await isProjectOwner(projectId, userId)
  const isUploader  = s?.uploaded_by === userId
  const isOwnerOnly = s?.instrument === 'master' || s?.instrument === 'smart_bounce'
  if (isOwnerOnly ? !owner : !(owner || isUploader)) {
    return c.json({ data: null, error: isOwnerOnly
      ? 'Only the project owner can delete the mix/master'
      : "You can only delete your own stems", status: 403 }, 403)
  }
  if (s?.storage_path) {
    await deleteFromR2(s.storage_path).catch(e => console.error('[delete] R2 error:', e.message))
    if (s.file_size && s.uploaded_by) {
      ;(async () => { try { await supabase.rpc('decrement_storage', { user_id: s.uploaded_by, bytes: s.file_size }) } catch {} })()
    }
  }
  // The playback asset (AAC, or MP3 for older stems) is a SEPARATE R2 object
  // from storage_path — deleting only the master here used to leak this one on
  // every stem delete, permanently. Best-effort: never blocks the actual delete.
  let previewKey: string | null = null
  try { previewKey = JSON.parse(s?.notes || '{}').preview || null } catch {}
  if (previewKey) await deleteFromR2(previewKey).catch(e => console.error('[delete] R2 preview error:', e.message))

  const { error } = await supabase.from('stems').delete().eq('id', c.req.param('id'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'File deleted' }, error: null, status: 200 })
})

// ── POST /files/:id/archive — toggle archived (soft-hide, kept in storage) ────
// Lets a producer tuck away an old take without deleting it. Same gate as delete:
// the uploader or the project owner. The stem stays in R2 + counts toward storage.
files.post('/:id/archive', async (c) => {
  const userId = c.var.user.id
  const id = c.req.param('id')
  const projectId = await projectIdForStem(id)
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)
  const { data: stem } = await supabase.from('stems').select('notes, uploaded_by').eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const owner = await isProjectOwner(projectId, userId)
  if (!owner && (stem as any).uploaded_by !== userId)
    return c.json({ data: null, error: 'You can only archive your own stems', status: 403 }, 403)
  let notes: any = {}; try { notes = JSON.parse((stem as any).notes || '{}') } catch {}
  notes.archived = !notes.archived
  const { error } = await supabase.from('stems').update({ notes: JSON.stringify(notes) }).eq('id', id)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { archived: notes.archived }, error: null, status: 200 })
})

// ── GET /files (query by track) ────────────────────────────────────────────────
files.get('/', async (c) => {
  const trackId = c.req.query('track_id')
  // Must scope to a track in a project the caller can access — never dump stems
  // across the whole table, and never a track from a project you're not on.
  if (!trackId) return c.json({ data: null, error: 'track_id is required', status: 400 }, 400)
  const { data: track } = await supabase.from('tracks').select('project_id').eq('id', trackId).single()
  const projectId = (track as any)?.project_id
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const query = supabase.from('stems').select('*').eq('track_id', trackId).order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Song-scoped collaborators only get stems inside their songs, same rule as
  // /projects/:id/files — this route must not become the unscoped back door.
  const scope = await songScopeFor(projectId, c.var.user.id)
  const scoped = scope ? (data as any[]).filter(s => s.folder_id && scope.includes(s.folder_id)) : (data as any[])

  const enriched = await Promise.all(
    scoped.map(async (stem) => {
      const key = stem?.storage_path || r2KeyFromUrl(stem?.file_url)
      if (key) stem.file_url = await getR2SignedUrl(key)
      return stem
    })
  )

  return c.json({ data: enriched, error: null, status: 200 })
})

// ── POST /files/:id/like — toggle like on a stem ─────────────────────────────
files.post('/:id/like', async (c) => {
  const userId = c.var.user.id
  const stemId = c.req.param('id')

  const projectId = await projectIdForStem(stemId)
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: stem } = await supabase
    .from('stems').select('notes').eq('id', stemId).single()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  let notes: any = {}
  try { notes = JSON.parse((stem as any).notes || '{}') } catch {}

  const liked: string[] = notes.liked_by || []
  const alreadyLiked    = liked.includes(userId)
  const updatedLikes    = alreadyLiked
    ? liked.filter((id: string) => id !== userId)
    : [...liked, userId]

  await supabase.from('stems').update({
    notes: JSON.stringify({ ...notes, liked_by: updatedLikes }),
  }).eq('id', stemId)

  return c.json({ data: { liked: !alreadyLiked, count: updatedLikes.length }, error: null, status: 200 })
})

// ── POST /files/:id/approve — toggle approved status on a stem ────────────────
files.post('/:id/approve', async (c) => {
  const userId = c.var.user.id
  const stemId = c.req.param('id')

  const projectId = await projectIdForStem(stemId)
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: stem } = await supabase
    .from('stems').select('notes').eq('id', stemId).single()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  let notes: any = {}
  try { notes = JSON.parse((stem as any).notes || '{}') } catch {}

  const approved     = !notes.approved
  const approvedBy   = approved ? userId : null
  const approvedAt   = approved ? new Date().toISOString() : null

  await supabase.from('stems').update({
    notes: JSON.stringify({ ...notes, approved, approved_by: approvedBy, approved_at: approvedAt }),
  }).eq('id', stemId)

  return c.json({ data: { approved, approved_by: approvedBy }, error: null, status: 200 })
})

export default files
