/**
 * Critical-path smoke test (M3/M5 #29). Run against a live deployment to verify
 * the upload → mix → export path is healthy.
 *
 *   SMOKE_BASE_URL=https://app.dizko.ai/api bun src/scripts/smoke.ts
 *   SMOKE_TOKEN=<jwt> bun src/scripts/smoke.ts            # + authed read checks
 *   SMOKE_TOKEN=<jwt> bun src/scripts/smoke.ts --full     # + mutating path
 *
 * Tiers:
 *   (default)  health + auth-gating — safe, no side effects, no token needed
 *   SMOKE_TOKEN          adds read checks (list projects)
 *   --full               creates a throwaway project, uploads a tiny WAV, runs a
 *                        smart-bounce, starts + polls an export, then deletes the
 *                        project. NOTE: an upload triggers AI naming + Replicate
 *                        stem separation — this costs money and writes real data.
 *
 * Exit code is non-zero if any check fails (usable in a deploy gate).
 */

const BASE  = (process.env.SMOKE_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '')
const TOKEN = process.env.SMOKE_TOKEN ?? ''
const FULL  = process.argv.includes('--full')

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = ''): boolean {
  if (ok) { passed++; console.log(`  ✓ ${name}`) }
  else    { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
  return ok
}

const auth = (extra: Record<string, string> = {}) =>
  TOKEN ? { Authorization: `Bearer ${TOKEN}`, ...extra } : extra

/** Minimal valid 0.1s silent mono 16-bit WAV — enough to pass upload + analysis. */
export function tinyWav(): Buffer {
  const sampleRate = 8000
  const numSamples = Math.floor(sampleRate * 0.1)
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)             // fmt chunk size
  buf.writeUInt16LE(1, 20)              // PCM
  buf.writeUInt16LE(1, 22)              // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32)              // block align
  buf.writeUInt16LE(16, 34)             // bits/sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf                            // sample region is silence (zeros)
}

async function main(): Promise<void> {
  console.log(`\nDizko smoke test → ${BASE}\n`)

  // ── Tier 1: liveness + auth gating (no token) ──────────────────────────────
  console.log('Liveness')
  try {
    const res = await fetch(`${BASE}/health`)
    const json: any = await res.json().catch(() => ({}))
    check('GET /health → 200', res.status === 200, `got ${res.status}`)
    check('health.status == ok', json?.data?.status === 'ok')
    check('supabase configured', json?.data?.supabase === true)
  } catch (e) {
    check('GET /health reachable', false, (e as Error).message)
  }

  console.log('\nAuth gating')
  try {
    const res = await fetch(`${BASE}/projects`)
    check('GET /projects without token → 401', res.status === 401, `got ${res.status}`)
  } catch (e) {
    check('GET /projects reachable', false, (e as Error).message)
  }

  // ── Tier 2: authed reads ───────────────────────────────────────────────────
  if (TOKEN) {
    console.log('\nAuthed reads')
    try {
      const res = await fetch(`${BASE}/projects`, { headers: auth() })
      const json: any = await res.json().catch(() => ({}))
      check('GET /projects (authed) → 200', res.status === 200, `got ${res.status}`)
      check('projects payload is an array', Array.isArray(json?.data))
    } catch (e) {
      check('GET /projects (authed) reachable', false, (e as Error).message)
    }
  } else {
    console.log('\n(skip authed reads — set SMOKE_TOKEN)')
  }

  // ── Tier 3: full mutating critical path ────────────────────────────────────
  if (TOKEN && FULL) {
    console.log('\nCritical path (create → upload → mix → export)')
    let projectId: string | null = null
    try {
      // create
      const cRes = await fetch(`${BASE}/projects`, {
        method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: `smoke-${Date.now()}`, type: 'Single' }),
      })
      const cJson: any = await cRes.json().catch(() => ({}))
      projectId = cJson?.data?.id ?? null
      check('create project → 200 + id', cRes.status === 200 && !!projectId, `got ${cRes.status}`)
      if (!projectId) throw new Error('no project id')

      // upload a tiny wav
      const fd = new FormData()
      fd.append('file', new Blob([tinyWav()], { type: 'audio/wav' }), 'smoke.wav')
      const uRes = await fetch(`${BASE}/projects/${projectId}/files`, { method: 'POST', headers: auth(), body: fd })
      check('upload stem → 2xx', uRes.ok, `got ${uRes.status}`)

      // smart-bounce (mix)
      const mRes = await fetch(`${BASE}/projects/${projectId}/smart-bounce`, { method: 'POST', headers: auth() })
      check('smart-bounce → 2xx', mRes.ok, `got ${mRes.status}`)

      // export: start + poll
      const sRes = await fetch(`${BASE}/projects/${projectId}/export?format=all`, { method: 'POST', headers: auth() })
      const sJson: any = await sRes.json().catch(() => ({}))
      const jobId = sJson?.data?.jobId
      check('start export → jobId', sRes.status === 202 && !!jobId, `got ${sRes.status}`)

      if (jobId) {
        let status = 'pending'
        for (let i = 0; i < 60 && status === 'pending'; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const pRes = await fetch(`${BASE}/projects/${projectId}/export/${jobId}`, { headers: auth() })
          const pJson: any = await pRes.json().catch(() => ({}))
          status = pJson?.data?.status ?? 'error'
        }
        check('export completes (status=done)', status === 'done', `final status: ${status}`)
      }
    } catch (e) {
      check('critical path completed', false, (e as Error).message)
    } finally {
      if (projectId) {
        const dRes = await fetch(`${BASE}/projects/${projectId}`, { method: 'DELETE', headers: auth() })
        check('cleanup: delete project', dRes.ok, `got ${dRes.status}`)
      }
    }
  } else if (TOKEN) {
    console.log('\n(skip critical path — pass --full to run it; it costs $ and writes data)')
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

if (import.meta.main) main()
