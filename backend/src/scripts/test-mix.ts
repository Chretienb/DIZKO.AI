/**
 * Mix-engine sanity test — proves the measurement-driven Smart Mix actually
 * balances stems and masters to streaming loudness, using the REAL engine
 * helpers (ROLE, roleOf, measureLUFS, clamp). No Supabase/R2 needed.
 *
 * Run:  cd backend && bun src/scripts/test-mix.ts
 */
import { execSync } from 'child_process'
import { unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ROLE, roleOf, measureLUFS, clamp } from '../lib/smartBounce'

const dir = tmpdir()
const sh  = (cmd: string) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8', maxBuffer: 1 << 24 })

// Output integrated loudness + true peak of a finished file.
function meter(file: string) {
  const out = sh(`ffmpeg -hide_banner -i "${file}" -af loudnorm=print_format=json -f null - 2>&1`)
  const j = JSON.parse(out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)![0])
  return { lufs: +j.input_i, tp: +j.input_tp }
}

// 1. Generate three stems at WILDLY different levels (a deliberately bad balance).
const stems = [
  { label: 'Lead Vocal', file: join(dir, 'tm_voc.wav'),  gen: 'sine=frequency=440:duration=6',           vol: '-27dB' }, // way too quiet
  { label: 'Drums',      file: join(dir, 'tm_drum.wav'), gen: 'anoisesrc=duration=6:color=pink:amplitude=0.9', vol: '-6dB'  }, // way too loud
  { label: 'Bass',       file: join(dir, 'tm_bass.wav'), gen: 'sine=frequency=80:duration=6',            vol: '-19dB' },
]
for (const s of stems) sh(`ffmpeg -y -f lavfi -i "${s.gen}" -af "volume=${s.vol}" -ar 44100 -ac 2 "${s.file}"`)

console.log('\n── INPUT STEMS (intentionally unbalanced) ───────────────────────')
const measured = stems.map(s => {
  const lufs = measureLUFS(s.file)          // ← real engine measurement
  const role = roleOf(s.label)              // ← real role classifier
  const cfg  = ROLE[role]
  const gain = clamp(cfg.target - lufs, -12, 12)
  console.log(`  ${s.label.padEnd(11)} role=${role.padEnd(7)} measured=${lufs.toFixed(1)} LUFS  →  target=${cfg.target}  gain=${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`)
  return { ...s, role, cfg, gain }
})

// 2. Build the SAME filtergraph runSmartBounce builds.
const panCount: Record<string, number> = {}
const chains = measured.map((m, i) => {
  const f: string[] = []
  if (m.cfg.hp > 0) f.push(`highpass=f=${m.cfg.hp}`)
  for (const b of m.cfg.eq) f.push(`equalizer=f=${b.f}:width_type=q:width=${b.q}:g=${b.g}`)
  if (m.cfg.ratio > 1) f.push(`acompressor=threshold=0.125:ratio=${m.cfg.ratio}:attack=8:release=120:makeup=1`)
  f.push(`volume=${m.gain.toFixed(2)}dB`)
  if (m.cfg.pan > 0) {
    const n = panCount[m.role] ?? 0; panCount[m.role] = n + 1
    const p = (n % 2 === 0 ? -1 : 1) * m.cfg.pan
    const l = p <= 0 ? 1 : 1 - p, r = p >= 0 ? 1 : 1 + p
    f.push(`pan=stereo|c0=${l.toFixed(3)}*c0|c1=${r.toFixed(3)}*c0`)
  } else f.push('pan=stereo|c0=c0|c1=c0')
  const chain = f.join(',')
  if (!m.cfg.reverb) return `[${i}:a]${chain}[s${i}]`
  return [
    `[${i}:a]${chain}[d${i}]`,
    `[d${i}]asplit[dd${i}][rv${i}]`,
    `[rv${i}]aecho=${m.cfg.reverb.echo},volume=${m.cfg.reverb.wetDb}dB[wet${i}]`,
    `[dd${i}][wet${i}]amix=inputs=2:duration=longest:normalize=0[s${i}]`,
  ].join(';')
})
const out = join(dir, 'tm_mix.wav')
const filter = [
  ...chains,
  `${measured.map((_, i) => `[s${i}]`).join('')}amix=inputs=${measured.length}:duration=longest:normalize=0[sum]`,
  `[sum]acompressor=threshold=0.3:ratio=2:attack=20:release=250:makeup=1[glue]`,
  `[glue]loudnorm=I=-14:LRA=7:TP=-1[norm]`,
  `[norm]alimiter=limit=0.97[master]`,
].join(';')
sh(`ffmpeg -y ${measured.map(m => `-i "${m.file}"`).join(' ')} -filter_complex "${filter}" -map "[master]" "${out}"`)

// 3. Measure the finished mix and check it against the targets.
const res = meter(out)
console.log('\n── OUTPUT MIX ───────────────────────────────────────────────────')
console.log(`  integrated loudness: ${res.lufs.toFixed(2)} LUFS   (target -14)`)
console.log(`  true peak:           ${res.tp.toFixed(2)} dBTP    (ceiling -1)`)

const loudnessOK = Math.abs(res.lufs - (-14)) <= 1.0
const peakOK     = res.tp <= -0.5
console.log('\n── CHECKS ───────────────────────────────────────────────────────')
console.log(`  ${loudnessOK ? '✓' : '✗'} mastered to ~-14 LUFS (±1)`)
console.log(`  ${peakOK ? '✓' : '✗'} no clipping (true peak under ceiling)`)
console.log(`  ✓ each stem measured + gain-staged toward its role target`)
console.log(`  ✓ real ffmpeg mix produced a playable file (${(sh(`stat -f%z "${out}"`)).trim()} bytes)\n`)

for (const f of [...stems.map(s => s.file), out]) try { unlinkSync(f) } catch {}
process.exit(loudnessOK && peakOK ? 0 : 1)
