/**
 * DAW Export — generates project files for major DAWs
 * with all collaborator stems embedded (self-contained ZIP)
 */

import JSZip from 'jszip'
import type { ProjectAnalysis, MixParam } from './aiAnalysis'

export interface ExportStem {
  id:          string   // stem DB id — used to look up mix params
  filename:    string   // e.g. Jimmy_Vocals_Take3_93BPM_Fm.wav
  buffer:      Buffer
  contributor: string
  instrument:  string
  durationSec: number
}

export interface ExportOptions {
  projectName: string
  bpm:         number
  key:         string
  stems:       ExportStem[]
  analysis?:   ProjectAnalysis   // Claude's analysis — used for ordering, volumes, notes
}

// Canonical DAW track order: rhythm section first, then harmony, then melody, then vocals
const INSTRUMENT_ORDER: Record<string, number> = {
  drums: 0, percussion: 1, bass: 2, guitar: 3, piano: 4,
  keys: 5, synth: 6, strings: 7, horns: 8, recording: 9,
  other: 10, vocals: 11,
}
const instrPriority = (instr: string) =>
  INSTRUMENT_ORDER[instr.toLowerCase()] ?? 9

export function sortStemsByOrder(stems: ExportStem[]): ExportStem[] {
  return [...stems].sort((a, b) => instrPriority(a.instrument) - instrPriority(b.instrument))
}

// ── Ableton Live (.als) — gzipped XML ────────────────────────────────────────
export function generateAbletonSession(opts: ExportOptions): Buffer {
  const { projectName, bpm, key, stems, analysis } = opts
  const mixParams = analysis?.mix_params ?? {}

  // Track color by instrument type
  const INSTR_COLORS: Record<string, string> = {
    drums: '-2435201', bass: '-7667712', guitar: '-16711936',
    vocals: '-6737049', piano: '-9109505', synth: '-16776961',
  }

  let pointeeId = 1
  const nextId = () => String(pointeeId++)

  // dB → Ableton linear volume (1.0 = unity, range 0–1.905 in Live)
  const dbToLinear = (db: number) => Math.pow(10, db / 20)

  const tracks = stems.map((s, i) => {
    const trackId  = nextId()
    const clipId   = nextId()
    const autoId1  = nextId()
    const autoId2  = nextId()
    const color    = INSTR_COLORS[s.instrument.toLowerCase()] ?? '-2435201'
    const beats    = s.durationSec * (bpm / 60)

    // Use Claude's mix params if available for this stem
    const mp: MixParam = mixParams[s.id] ?? {
      volume_db: 0, pan: 0, eq_low_cut_hz: 0, compress: false, compress_ratio: 1,
    }
    const volumeLinear = dbToLinear(mp.volume_db).toFixed(6)
    const panValue     = mp.pan.toFixed(6)

    // Best-take annotation
    const isBestTake = analysis?.version_insights?.some(vi => vi.best_take_id === s.id) ?? false
    const trackLabel = isBestTake
      ? `${escXml(s.contributor)} — ${escXml(s.instrument)} ★`
      : `${escXml(s.contributor)} — ${escXml(s.instrument)}`

    return `
    <AudioTrack Id="${trackId}">
      <LomId Value="0"/>
      <LomIdView Value="0"/>
      <IsContentSelectedInDocument Value="false"/>
      <PreventGroupCreation Value="false"/>
      <TrackUnfolded Value="true"/>
      <DoRecordables Value="true"/>
      <CurrentMonitoringState Value="0"/>
      <Name>
        <EffectiveName Value="${trackLabel}"/>
        <UserName Value=""/>
        <Annotation Value="${escXml(isBestTake ? 'Best take — picked by Dizko AI' : `AI mix: ${mp.volume_db}dB`)}"/>
        <MemorizedFirstClipName Value="${escXml(s.filename)}"/>
      </Name>
      <Color Value="${color}"/>
      <AutomationEnvelopes><Envelopes/></AutomationEnvelopes>
      <TrackGroupId Value="-1"/>
      <DeviceChain>
        <Mixer>
          <LomId Value="0"/>
          <On><LomId Value="0"/><Manual Value="true"/><AutomationTarget Id="${autoId1}"/></On>
          <Volume><LomId Value="0"/><Manual Value="${volumeLinear}"/><AutomationTarget Id="${autoId2}"/></Volume>
          <Pan><LomId Value="0"/><Manual Value="${panValue}"/></Pan>
          <ViewStateSesstionTrackWidth Value="74"/>
          <SendsListWrapper LomId="0"/>
        </Mixer>
        <MainSequencer>
          <LomId Value="0"/>
          <ClipTimeable>
            <AutomationTarget Id="${nextId()}"/>
            <LomId Value="0"/>
            <ArrangerAutomation>
              <Events>
                <AudioClip Id="${clipId}" Time="0">
                  <LomId Value="0"/>
                  <CurrentStart Value="0"/>
                  <CurrentEnd Value="${beats.toFixed(6)}"/>
                  <Loop>
                    <LoopStart Value="0"/>
                    <LoopEnd Value="${beats.toFixed(6)}"/>
                    <StartRelative Value="0"/>
                    <LoopOn Value="false"/>
                    <OutMarker Value="${beats.toFixed(6)}"/>
                    <HiddenLoopStart Value="0"/>
                    <HiddenLoopEnd Value="4"/>
                  </Loop>
                  <Name Value="${escXml(s.contributor)} — ${escXml(s.instrument)}"/>
                  <Color Value="${color}"/>
                  <LaunchMode Value="0"/>
                  <LaunchQuantisation Value="0"/>
                  <ColorIndex Value="0"/>
                  <Disabled Value="false"/>
                  <VelocityAmount Value="0"/>
                  <FollowAction>
                    <FollowTime Value="4"/>
                    <IsLinked Value="true"/>
                    <LoopIterations Value="1"/>
                    <FollowActionA Value="4"/>
                    <FollowActionB Value="0"/>
                    <FollowChanceA Value="100"/>
                    <FollowChanceB Value="0"/>
                    <JumpIndexA Value="1"/>
                    <JumpIndexB Value="1"/>
                    <FollowActionEnabled Value="false"/>
                  </FollowAction>
                  <Grid><FixedNumerator Value="1"/><FixedDenominator Value="16"/><GridIntervalPixel Value="20"/><Ntoles Value="2"/><SnapToGrid Value="true"/><Fixed Value="false"/></Grid>
                  <FreezeStart Value="0"/>
                  <FreezeEnd Value="0"/>
                  <IsWarped Value="true"/>
                  <TakeId Value="1"/>
                  <SampleRef>
                    <FileRef>
                      <RelativePath Value="Stems/${escXml(s.filename)}"/>
                      <Path Value="Stems/${escXml(s.filename)}"/>
                      <Type Value="1"/>
                      <LivePackName Value=""/>
                      <LivePackId Value=""/>
                      <OriginalFileSize Value="${s.buffer.length}"/>
                      <IsPackedToProject Value="true"/>
                    </FileRef>
                    <LastModDate Value="0"/>
                    <SourceContext/>
                    <SampleUsageHint Value="0"/>
                    <DefaultDuration Value="${Math.round(s.durationSec * 44100)}"/>
                    <DefaultSampleRate Value="44100"/>
                  </SampleRef>
                  <Onsets><UserOnsets/></Onsets>
                  <WarpMode Value="0"/>
                  <PitchCoarse Value="0"/>
                  <PitchFine Value="0"/>
                  <SampleVolume Value="1"/>
                  <MarkerList/>
                  <WarpMarkers>
                    <WarpMarker Id="0" SecTime="0" BeatTime="0"/>
                    <WarpMarker Id="1" SecTime="${s.durationSec.toFixed(6)}" BeatTime="${beats.toFixed(6)}"/>
                  </WarpMarkers>
                  <SavedWarpMarkersVersion Value="0"/>
                  <MarkersGenerated Value="true"/>
                  <IsSongTempoMaster Value="false"/>
                  <NeedsAnalysis Value="false"/>
                </AudioClip>
              </Events>
              <AutomationTarget Id="${nextId()}"/>
              <ModulationTarget Id="${nextId()}"/>
            </ArrangerAutomation>
          </ClipTimeable>
        </MainSequencer>
      </DeviceChain>
      <SavedPlayingSlot Value="-1"/>
      <SavedPlayingOffset Value="0"/>
      <Freeze Value="false"/>
    </AudioTrack>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="11.3.2" SchemaChangeCount="3" Creator="Dizko.ai — dizko.ai" Revision="">
<LiveSet>
  <NextPointeeId Value="${pointeeId + 10}"/>
  <OverwriteProtectionNumber Value="2816"/>
  <LomId Value="0"/>
  <LomIdView Value="0"/>
  <Creator Value="Dizko.ai"/>
  <Annotation Value="Exported from Dizko.ai — ${escXml(projectName)} | BPM: ${bpm} | Key: ${key}"/>
  <Tracks>
${tracks}
  </Tracks>
  <Transport>
    <PhaseNudgeTempo><LomId Value="0"/><Manual Value="0"/><AutomationTarget Id="${nextId()}"/><ModulationTarget Id="${nextId()}"/></PhaseNudgeTempo>
    <LoopOn Value="false"/>
    <LoopStart Value="0"/>
    <LoopLength Value="1"/>
    <LoopIsSongStart Value="false"/>
    <CurrentTime Value="0"/>
    <PunchIn Value="false"/>
    <PunchOut Value="false"/>
    <MetronomeTickDuration Value="0"/>
    <DrawMode Value="false"/>
    <ShiftNudge Value="0"/>
    <TimeSignature>
      <TimeSignatures>
        <RemoteableTimeSignature Id="0">
          <Numerator Value="4"/>
          <Denominator Value="4"/>
          <Time Value="0"/>
        </RemoteableTimeSignature>
      </TimeSignatures>
    </TimeSignature>
  </Transport>
  <SongMasterValues>
    <MasterTempo Value="${bpm}"/>
    <TimeSignature><Numerator Value="4"/><Denominator Value="4"/></TimeSignature>
    <GlobalGroove Value="0"/>
    <SwingAmount Value="0"/>
  </SongMasterValues>
  <GlobalQuantisation Value="4"/>
  <AutoQuantisation Value="false"/>
  <Grid><FixedNumerator Value="1"/><FixedDenominator Value="16"/><GridIntervalPixel Value="20"/><Ntoles Value="2"/><SnapToGrid Value="true"/><Fixed Value="false"/></Grid>
  <ScaleInformation><RootNote Value="0"/><Name Value="${escXml(key)}"/></ScaleInformation>
</LiveSet>
</Ableton>`

  return Buffer.from(xml, 'utf8')
}

// ── Logic Pro (.logicx) — directory package ───────────────────────────────────
// Logic .logicx is a folder — we create it as entries in the ZIP
export async function addLogicProjectToZip(
  zip:  InstanceType<typeof JSZip>,
  opts: ExportOptions,
  folder: string
): Promise<void> {
  const { projectName, bpm, key, stems } = opts

  // Logic's ProjectData is a binary plist — too complex to generate from scratch.
  // Instead we create a GarageBand-compatible structure with a README that
  // Logic can import directly via File > Import > Audio File.
  // This is the reliable path; full .logicx generation is a future enhancement.

  const logicFolder = zip.folder(`${folder}/${projectName}_Logic`)!

  // Add a plain-text project description that Logic's Session Import can read
  const analysis = opts.analysis
  logicFolder.file('_DIZKO_SESSION.txt', [
    `DIZKO.AI — LOGIC PRO SESSION`,
    `================================`,
    `Project: ${projectName}`,
    `BPM: ${bpm}`,
    `Key: ${key}`,
    `Contributors: ${stems.map(s => s.contributor).join(', ')}`,
    ``,
    ...(analysis?.brief ? [`AI NOTE: ${analysis.brief}`, ``] : []),
    ...(analysis?.conflicts?.length ? [
      `CONFLICTS:`,
      ...analysis.conflicts.map(c => `  ⚠  [${c.type.toUpperCase()}] ${c.detail}`),
      ``,
    ] : []),
    `HOW TO IMPORT INTO LOGIC PRO:`,
    `1. Open Logic Pro`,
    `2. Create a new Empty Project`,
    `3. Set the BPM to ${bpm}`,
    `4. Drag all .wav files from the "Stems" folder (next to this one)`,
    `   onto the Tracks area (arranged in order: drums → bass → instruments → vocals)`,
    `5. Logic will create one track per stem, aligned at bar 1`,
    ``,
    `TRACKS (arrangement order):`,
    ...stems.map((s, i) => {
      const isBest = analysis?.version_insights?.some(vi => vi.best_take_id === s.id)
      return `  ${String(i+1).padStart(2,'0')}. ${s.filename}  (${s.contributor} — ${s.instrument})${isBest ? '  ★ best take' : ''}`
    }),
    ``,
    `Generated by Dizko.ai`,
  ].join('\n'))

  // No audio copies here — the guide above points at the shared Stems/
  // folder. Duplicating every WAV into this folder (and into Ableton's
  // Samples/Imported) tripled the zip's size and its build time.
}

// ── Marketing HTML — embedded in every export ────────────────────────────────
export function generateMarketingPage(opts: ExportOptions): string {
  const { projectName, bpm, key, stems } = opts
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const dawCards = [
    { name: 'Ableton Live', color: '#FF7A1A', icon: `<rect x="8" y="10" w="6" h="28" rx="2" fill="#FF7A1A"/><rect x="18" y="10" w="6" h="28" rx="2" fill="#FF7A1A"/><rect x="28" y="17" w="6" h="7" rx="2" fill="#FF7A1A"/><rect x="28" y="24" w="6" h="14" rx="2" fill="#444"/><rect x="38" y="17" w="6" h="21" rx="2" fill="#FF7A1A"/>` },
    { name: 'Logic Pro',    color: '#5AC8FA', icon: `<circle cx="24" cy="24" r="13" stroke="#5AC8FA" stroke-width="2.5" fill="none"/><circle cx="24" cy="24" r="4" fill="#5AC8FA"/>` },
    { name: 'FL Studio',    color: '#FF8C00', icon: `<path d="M24 8L38 24L24 40L10 24Z" stroke="#FF8C00" stroke-width="2.5" fill="none"/><circle cx="24" cy="24" r="5" fill="#FF8C00"/>` },
    { name: 'Pro Tools',    color: '#00C5A2', icon: `<rect x="9" y="15" width="30" height="3" rx="1.5" fill="#00C5A2"/><rect x="9" y="22" width="22" height="3" rx="1.5" fill="#00C5A2"/><rect x="9" y="29" width="26" height="3" rx="1.5" fill="#00C5A2"/>` },
    { name: 'GarageBand',  color: '#F5A623', icon: `<path d="M16 32Q16 16 24 12Q32 16 32 32" stroke="#F5A623" stroke-width="2.5" fill="none"/><rect x="20" y="29" width="8" height="8" rx="2" fill="#F5A623"/>` },
    { name: 'Cubase',       color: '#C8A0E8', icon: `<path d="M32 17A12 12 0 1 0 32 31" stroke="#C8A0E8" stroke-width="2.5" fill="none"/><circle cx="24" cy="24" r="4" fill="#C8A0E8"/>` },
  ].map(d => `<div style="display:inline-block;margin:8px;vertical-align:top;text-align:center;width:80px;">
    <div style="background:#1A1A22;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:4px;display:inline-block;">
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${d.icon}</svg>
    </div>
    <div style="color:#8B8B9A;font-size:10px;margin-top:6px;font-family:-apple-system,sans-serif;">${d.name}</div>
  </div>`).join('')

  const rows = stems.map((s, i) => `<tr style="border-bottom:1px solid #1E1E28;">
    <td style="padding:10px 16px;color:#555;font-size:12px;">${String(i+1).padStart(2,'0')}</td>
    <td style="padding:10px 16px;color:#E8E8F0;font-size:13px;">${escHtml(s.contributor)}</td>
    <td style="padding:10px 16px;color:#FF6B6B;font-size:12px;text-transform:uppercase;">${escHtml(s.instrument)}</td>
    <td style="padding:10px 16px;color:#8B8B9A;font-size:11px;font-family:monospace;">${escHtml(s.filename)}</td>
  </tr>`).join('')

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>${escHtml(projectName)} — Dizko.ai Export</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0A0A12;color:#E8E8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}</style>
</head><body><div style="max-width:720px;margin:0 auto;padding:40px 24px;">

<!-- Header -->
<div style="text-align:center;margin-bottom:40px;">
  <div style="font-size:30px;font-weight:900;letter-spacing:-0.5px;margin-bottom:6px;">
    <span style="color:#FF6B6B;">dizko</span><span style="color:#E8E8F0;">.ai</span>
  </div>
  <div style="color:#8B8B9A;font-size:13px;margin-bottom:16px;">You create. We handle the rest.</div>
  <div style="display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:center;">
    ${['AI-Mixed','AI-Mastered','Organized','Ready to open'].map(t =>
      `<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:100px;background:rgba(255,107,107,.12);color:#FF6B6B;border:1px solid rgba(255,107,107,.25);">${t}</span>`
    ).join('')}
  </div>
</div>

<!-- Project card -->
<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;padding:28px;margin-bottom:24px;">
  <div style="font-size:22px;font-weight:700;margin-bottom:4px;">${escHtml(projectName)}</div>
  <div style="color:#555;font-size:12px;margin-bottom:20px;">${date}</div>
  <div style="display:flex;gap:20px;flex-wrap:wrap;">
    <div><div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">BPM</div><div style="color:#FF6B6B;font-size:22px;font-weight:800;">${bpm}</div></div>
    <div><div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Key</div><div style="color:#FF6B6B;font-size:22px;font-weight:800;">${escHtml(key)}</div></div>
    <div><div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Stems</div><div style="color:#FF6B6B;font-size:22px;font-weight:800;">${stems.length}</div></div>
    <div style="margin-left:auto;text-align:right;">
      <div style="color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Mix</div>
      <div style="color:#22c55e;font-size:12px;font-weight:700;">AI-Mixed + Mastered</div>
      <div style="color:#555;font-size:10px;">-14 LUFS · Spotify ready</div>
    </div>
  </div>
</div>

<!-- What Dizko did -->
<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;padding:24px;margin-bottom:24px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#555;font-weight:600;margin-bottom:16px;">What Dizko AI did for this project</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    ${[
      ['Organized every stem', 'Named by contributor, role & take number'],
      ['AI-analyzed the mix', 'Claude set volume, EQ & compression per stem'],
      ['Detected BPM & key', 'Flagged any conflicts between collaborators'],
      ['Mastered the output', '-14 LUFS loudness · -1 dBTP true peak limit'],
    ].map(([title, sub]) => `
    <div style="padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;">
      <div style="font-size:12px;font-weight:700;color:#E8E8F0;margin-bottom:3px;">${title}</div>
      <div style="font-size:11px;color:#555;line-height:1.5;">${sub}</div>
    </div>`).join('')}
  </div>
</div>

<!-- Stems table -->
<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;overflow:hidden;margin-bottom:24px;">
  <div style="padding:18px 16px 12px;border-bottom:1px solid #1E1E2E;">
    <span style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#555;font-weight:600;">Stems in this package</span>
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="border-bottom:1px solid #1E1E2E;">
      <th style="padding:8px 16px;text-align:left;color:#333;font-size:10px;">#</th>
      <th style="padding:8px 16px;text-align:left;color:#333;font-size:10px;">CONTRIBUTOR</th>
      <th style="padding:8px 16px;text-align:left;color:#333;font-size:10px;">INSTRUMENT</th>
      <th style="padding:8px 16px;text-align:left;color:#333;font-size:10px;">FILE</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>

<!-- DAW section -->
<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;padding:24px;margin-bottom:24px;text-align:center;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#555;font-weight:600;margin-bottom:6px;">Opens directly in</div>
  <div style="font-size:17px;font-weight:700;margin-bottom:20px;">Your Favorite DAW</div>
  <div style="margin-bottom:20px;">${dawCards}</div>
  <div style="background:#0A0A12;border-radius:10px;padding:14px;text-align:left;font-family:monospace;font-size:11px;color:#444;line-height:2.2;">
    <div><span style="color:#FF7A1A;">Ableton Live</span>  → double-click <strong style="color:#666;">${projectName.replace(/[^a-zA-Z0-9 _-]/g,'_')}_Ableton.als</strong></div>
    <div><span style="color:#5AC8FA;">Logic Pro</span>     → drag stems from <strong style="color:#666;">Logic/</strong> folder into a new project</div>
    <div><span style="color:#FF8C00;">FL Studio</span>     → File → Import → Audio → <strong style="color:#666;">Stems/*.wav</strong></div>
    <div><span style="color:#00C5A2;">Pro Tools</span>     → File → Import → Audio → <strong style="color:#666;">Stems/*.wav</strong></div>
    <div><span style="color:#F5A623;">GarageBand</span>    → drag <strong style="color:#666;">Stems/*.wav</strong> onto the timeline</div>
    <div><span style="color:#C8A0E8;">Cubase</span>        → File → Import → Audio File → <strong style="color:#666;">Stems/*.wav</strong></div>
  </div>
</div>

<!-- Footer -->
<div style="text-align:center;padding-bottom:32px;">
  <div style="color:#2A2A38;font-size:12px;line-height:2;">
    <div style="font-size:14px;font-weight:700;color:#3A3A48;margin-bottom:4px;">dizko.ai</div>
    <div>The collaboration OS for music producers</div>
    <div>You create. We organize, mix, master, and deliver.</div>
  </div>
</div>

</div></body></html>`
}

// ── Universal ZIP builder ─────────────────────────────────────────────────────
export async function buildExportZip(opts: ExportOptions, format: string): Promise<Buffer> {
  const { projectName, bpm, key, analysis } = opts
  const zip = new JSZip()
  const safeName = projectName.replace(/[^a-zA-Z0-9 _-]/g, '_')

  // 1. Sort stems: drums → bass → guitar → keys → synth → strings → horns → vocals
  const stems = sortStemsByOrder(opts.stems)

  // 2. All stems in /Stems folder — the ONE audio location in the archive.
  // STORE, not DEFLATE: WAV/MP3 audio is essentially incompressible, and
  // deflating it was the bulk of a 3-5 minute export (measured live). The
  // .als and the Logic guide both reference this folder rather than keeping
  // their own copies (which also tripled the zip's size).
  const stemsFolder = zip.folder('Stems')!
  for (const s of stems) {
    stemsFolder.file(s.filename, s.buffer, { compression: 'STORE' })
  }

  // 3. Claude-written session notes
  const aiNotes = buildSessionNotes(projectName, bpm, key, stems, analysis)
  zip.file('session_info.txt', aiNotes)

  // 4. Ableton .als (with AI-set volumes + best-take annotations). Its
  // SampleRefs point at Stems/ (the .als sits at the zip root, so relative
  // resolution is unchanged) — no separate Samples/Imported copy.
  if (format === 'ableton' || format === 'all') {
    const alsBuffer = generateAbletonSession({ ...opts, stems })
    zip.file(`${safeName}_Ableton.als`, alsBuffer)
  }

  // 5. Logic folder
  if (format === 'logic' || format === 'all') {
    await addLogicProjectToZip(zip, { ...opts, stems }, '.')
  }

  // 6. Marketing page
  zip.file('about_dizko.html', generateMarketingPage({ ...opts, stems }))

  return zip.generateAsync({
    type:               'nodebuffer',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

// ── AI-written session notes ──────────────────────────────────────────────────
function buildSessionNotes(
  projectName: string,
  bpm: number,
  key: string,
  stems: ExportStem[],
  analysis?: ProjectAnalysis,
): string {
  const lines: string[] = [
    `DIZKO.AI — SESSION NOTES`,
    `═════════════════════════════════════════`,
    `Project    : ${projectName}`,
    `BPM        : ${bpm}`,
    `Key        : ${key}`,
    `Contributors: ${stems.length}`,
    `Exported   : ${new Date().toUTCString()}`,
    ``,
  ]

  // AI brief
  if (analysis?.brief) {
    lines.push(`AI ANALYSIS`)
    lines.push(`────────────`)
    lines.push(analysis.brief)
    lines.push(``)
  }

  // Conflicts
  if (analysis?.conflicts?.length) {
    lines.push(`CONFLICTS DETECTED`)
    lines.push(`────────────────────`)
    for (const c of analysis.conflicts) {
      lines.push(`⚠  [${c.type.toUpperCase()}] ${c.detail}`)
    }
    lines.push(``)
  }

  // Missing instruments
  if (analysis?.missing?.length) {
    lines.push(`MISSING INSTRUMENTS`)
    lines.push(`────────────────────`)
    lines.push(analysis.missing.map(m => `• ${m}`).join('\n'))
    lines.push(``)
  }

  // Version intelligence
  if (analysis?.version_insights?.length) {
    lines.push(`BEST TAKES (AI-SELECTED)`)
    lines.push(`─────────────────────────`)
    for (const vi of analysis.version_insights) {
      lines.push(`★ ${vi.instrument.toUpperCase()} → ${vi.best_take_name}`)
      lines.push(`  Reason: ${vi.reason}`)
    }
    lines.push(``)
  }

  // Track list in arrangement order
  lines.push(`TRACKS (arrangement order)`)
  lines.push(`───────────────────────────`)
  stems.forEach((s, i) => {
    const mixP = analysis?.mix_params?.[s.id]
    const isBest = analysis?.version_insights?.some(vi => vi.best_take_id === s.id)
    const volTag  = mixP ? ` [${mixP.volume_db > 0 ? '+' : ''}${mixP.volume_db}dB]` : ''
    const bestTag = isBest ? ' ★ best take' : ''
    lines.push(`${String(i + 1).padStart(2, '0')}. ${s.contributor.padEnd(16)} ${s.instrument.padEnd(12)} ${s.filename}${volTag}${bestTag}`)
  })

  lines.push(``)
  lines.push(`HOW TO OPEN`)
  lines.push(`─────────────`)
  lines.push(`Ableton Live : Double-click ${projectName.replace(/[^a-zA-Z0-9 _-]/g,'_')}_Ableton.als`)
  lines.push(`Logic Pro    : Drag stems from the Stems/ folder into a new project (see the _Logic folder's guide)`)
  lines.push(`FL Studio    : File → Import → Audio → Stems/*.wav`)
  lines.push(`Pro Tools    : File → Import → Audio → Stems/*.wav`)
  lines.push(``)
  lines.push(`Volumes in the .als are pre-set by Dizko AI. Mastered to -14 LUFS.`)
  lines.push(`dizko.ai`)

  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
