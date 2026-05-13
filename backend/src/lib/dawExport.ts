/**
 * DAW Export — generates project files for major DAWs
 * with all collaborator stems embedded (self-contained ZIP)
 */

import JSZip from 'jszip'

export interface ExportStem {
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
}

// ── Ableton Live (.als) — gzipped XML ────────────────────────────────────────
export function generateAbletonSession(opts: ExportOptions): Buffer {
  const { projectName, bpm, key, stems } = opts

  const TRACK_COLORS = [
    '-2435201',  // coral
    '-6737049',  // purple
    '-7667712',  // green
    '-16711936', // amber
    '-9109505',  // pink
    '-16776961', // blue
  ]

  let pointeeId = 1
  const nextId = () => String(pointeeId++)

  const tracks = stems.map((s, i) => {
    const trackId  = nextId()
    const clipId   = nextId()
    const autoId1  = nextId()
    const autoId2  = nextId()
    const color    = TRACK_COLORS[i % TRACK_COLORS.length]
    const beats    = s.durationSec * (bpm / 60)

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
        <EffectiveName Value="${escXml(s.contributor)} — ${escXml(s.instrument)}"/>
        <UserName Value=""/>
        <Annotation Value=""/>
        <MemorizedFirstClipName Value="${escXml(s.filename)}"/>
      </Name>
      <Color Value="${color}"/>
      <AutomationEnvelopes><Envelopes/></AutomationEnvelopes>
      <TrackGroupId Value="-1"/>
      <DeviceChain>
        <Mixer>
          <LomId Value="0"/>
          <On><LomId Value="0"/><Manual Value="true"/><AutomationTarget Id="${autoId1}"/></On>
          <Volume><LomId Value="0"/><Manual Value="1"/><AutomationTarget Id="${autoId2}"/></Volume>
          <Pan><LomId Value="0"/><Manual Value="0"/></Pan>
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
                      <RelativePath Value="Samples/Imported/${escXml(s.filename)}"/>
                      <Path Value="Samples/Imported/${escXml(s.filename)}"/>
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
  logicFolder.file('_DIZKO_SESSION.txt', [
    `DIZKO.AI — LOGIC PRO SESSION`,
    `================================`,
    `Project: ${projectName}`,
    `BPM: ${bpm}`,
    `Key: ${key}`,
    `Contributors: ${stems.map(s => s.contributor).join(', ')}`,
    ``,
    `HOW TO IMPORT INTO LOGIC PRO:`,
    `1. Open Logic Pro`,
    `2. Create a new Empty Project`,
    `3. Set the BPM to ${bpm}`,
    `4. Drag all .wav files from this folder onto the Tracks area`,
    `5. Logic will create one track per stem, aligned at bar 1`,
    ``,
    `TRACKS:`,
    ...stems.map((s, i) => `  ${String(i+1).padStart(2,'0')}. ${s.filename}  (${s.contributor} — ${s.instrument})`),
    ``,
    `Generated by Dizko.ai — dizko.ai`,
  ].join('\n'))

  // Add stems directly in the Logic folder
  for (const s of stems) {
    logicFolder.file(s.filename, s.buffer)
  }
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

<div style="text-align:center;margin-bottom:48px;">
  <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:4px;">
    <span style="color:#FF6B6B;">dizko</span><span style="color:#E8E8F0;">.ai</span></div>
  <div style="color:#8B8B9A;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Collaborative Music Production</div>
</div>

<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;padding:28px;margin-bottom:32px;">
  <div style="font-size:22px;font-weight:700;margin-bottom:16px;">${escHtml(projectName)}</div>
  <div style="display:flex;gap:24px;flex-wrap:wrap;">
    <div><div style="color:#8B8B9A;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">BPM</div>
      <div style="color:#FF6B6B;font-size:20px;font-weight:700;">${bpm}</div></div>
    <div><div style="color:#8B8B9A;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Key</div>
      <div style="color:#FF6B6B;font-size:20px;font-weight:700;">${escHtml(key)}</div></div>
    <div><div style="color:#8B8B9A;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Contributors</div>
      <div style="color:#FF6B6B;font-size:20px;font-weight:700;">${stems.length}</div></div>
    <div style="margin-left:auto;"><div style="color:#8B8B9A;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Exported</div>
      <div style="color:#8B8B9A;font-size:13px;">${date}</div></div>
  </div>
</div>

<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;overflow:hidden;margin-bottom:32px;">
  <div style="padding:20px 16px 12px;border-bottom:1px solid #1E1E2E;">
    <span style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#8B8B9A;font-weight:600;">Stems in this package</span></div>
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="border-bottom:1px solid #1E1E2E;">
      <th style="padding:8px 16px;text-align:left;color:#555;font-size:11px;">#</th>
      <th style="padding:8px 16px;text-align:left;color:#555;font-size:11px;">CONTRIBUTOR</th>
      <th style="padding:8px 16px;text-align:left;color:#555;font-size:11px;">INSTRUMENT</th>
      <th style="padding:8px 16px;text-align:left;color:#555;font-size:11px;">FILE</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>

<div style="background:#13131C;border:1px solid #1E1E2E;border-radius:16px;padding:28px;margin-bottom:32px;text-align:center;">
  <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#8B8B9A;font-weight:600;margin-bottom:8px;">Works seamlessly with</div>
  <div style="font-size:18px;font-weight:700;margin-bottom:24px;">Your Favorite DAW</div>
  <div style="margin-bottom:24px;">${dawCards}</div>
  <div style="background:#0A0A12;border-radius:12px;padding:16px;text-align:left;font-family:monospace;font-size:12px;color:#555;line-height:2;">
    <div style="color:#8B8B9A;margin-bottom:4px;">// HOW TO OPEN</div>
    <div><span style="color:#FF7A1A;">Ableton Live</span>  → double-click the .als file in this ZIP</div>
    <div><span style="color:#5AC8FA;">Logic Pro</span>     → drag stems from the Logic/ folder into a new project</div>
    <div><span style="color:#FF8C00;">FL Studio</span>     → File → Import → Audio → select all .wav from Stems/</div>
    <div><span style="color:#00C5A2;">Pro Tools</span>     → File → Import → Audio → select all .wav from Stems/</div>
    <div><span style="color:#F5A623;">GarageBand</span>    → drag Stems/*.wav onto the GarageBand timeline</div>
    <div><span style="color:#C8A0E8;">Cubase</span>        → File → Import → Audio File → select Stems/*.wav</div>
  </div>
</div>

<div style="text-align:center;color:#3A3A4A;font-size:12px;line-height:1.8;padding-bottom:24px;">
  <div>Generated by <span style="color:#FF6B6B;">Dizko.ai</span> — The Collaboration OS for Music Producers</div>
  <div>All stems embedded — no internet connection required · dizko.ai</div>
</div>

</div></body></html>`
}

// ── Universal ZIP builder ─────────────────────────────────────────────────────
export async function buildExportZip(opts: ExportOptions, format: string): Promise<Buffer> {
  const { projectName, bpm, key, stems } = opts
  const zip = new JSZip()

  const safeName = projectName.replace(/[^a-zA-Z0-9 _-]/g, '_')

  // 1. All stems in /Stems folder (all formats)
  const stemsFolder = zip.folder('Stems')!
  for (const s of stems) {
    stemsFolder.file(s.filename, s.buffer)
  }

  // 2. Session info text
  zip.file('session_info.txt', [
    `DIZKO.AI EXPORT`,
    `═══════════════`,
    `Project    : ${projectName}`,
    `BPM        : ${bpm}`,
    `Key        : ${key}`,
    `Contributors: ${stems.length}`,
    `Exported   : ${new Date().toUTCString()}`,
    ``,
    `CONTRIBUTORS`,
    `────────────`,
    ...stems.map(s => `${s.contributor.padEnd(20)} ${s.instrument.padEnd(15)} ${s.filename}`),
    ``,
    `HOW TO USE`,
    `──────────`,
    `Ableton Live : Double-click ${safeName}_Ableton.als`,
    `Logic Pro    : Open the ${safeName}_Logic/ folder or drag stems to a new project`,
    `FL Studio    : File → Import → Audio — select all .wav files from Stems/`,
    `Pro Tools    : File → Import → Audio — select all .wav files from Stems/`,
    ``,
    `www.dizko.ai`,
  ].join('\n'))

  // 3. Ableton .als project
  if (format === 'ableton' || format === 'all') {
    const alsBuffer = generateAbletonSession(opts)
    zip.file(`${safeName}_Ableton.als`, alsBuffer)
    // Ableton also needs stems in Samples/Imported/ (relative path in .als)
    const samplesFolder = zip.folder('Samples/Imported')!
    for (const s of stems) {
      samplesFolder.file(s.filename, s.buffer)
    }
  }

  // 4. Logic folder
  if (format === 'logic' || format === 'all') {
    await addLogicProjectToZip(zip, opts, '.')
  }

  // 5. Marketing page — always included
  zip.file('about_dizko.html', generateMarketingPage(opts))

  return zip.generateAsync({
    type:               'nodebuffer',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  })
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
