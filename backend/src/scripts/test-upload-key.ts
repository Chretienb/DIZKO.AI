/**
 * Reproduce Angel's "upload did nothing" — does a presigned PUT to R2 actually
 * succeed for keys with special characters like his filenames
 * ("@angeldavinci.exe - BLOOM_snare2.wav")? Tests the real R2 round-trip.
 *
 * Run:  cd backend && bun src/scripts/test-upload-key.ts
 */
import { getR2PresignedPutUrl, getR2SignedUrl, deleteFromR2 } from '../lib/r2'

const names = [
  'BLOOM_snare.wav',                         // plain control
  '@angeldavinci.exe - BLOOM_snare2.wav',    // Angel's real pattern
  'OswaldVenus_OSWALDSMEMOIR_Cm_162_Drums.wav',
  'beat (final) #2 [master].wav',            // parens, hash, brackets
  'Voix début — accentué.wav',               // unicode/accents
]

const body = Buffer.from('RIFF....fake wav bytes for test')
let pass = 0, fail = 0

for (const name of names) {
  const key = `takes/_keytest/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}`
  try {
    const putUrl = await getR2PresignedPutUrl(key, 'audio/wav')
    const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body })
    const getUrl = await getR2SignedUrl(key, 120)
    const get = await fetch(getUrl)
    const ok = put.ok && get.ok
    console.log(`${ok ? '✓' : '✗'}  PUT ${put.status}  GET ${get.status}   "${name}"`)
    if (!ok) { fail++; if (!put.ok) console.log(`     PUT body: ${(await put.text()).slice(0, 240)}`) }
    else pass++
    await deleteFromR2(key).catch(() => {})
  } catch (e) {
    fail++
    console.log(`✗  THREW for "${name}": ${(e as Error).message}`)
  }
}

console.log(`\n${pass} ok, ${fail} failed`)
process.exit(fail ? 1 : 0)
