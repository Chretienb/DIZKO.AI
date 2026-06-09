// Database load test for the Dizko API — RAMPED, READ-ONLY, hits PROD Supabase.
//
// Measures the database read path (GET /projects → Postgres) under rising
// concurrency to find the latency "knee". Auth is cached after the first call
// (verifyToken caches the JWT→user lookup), so this isolates the DB query, just
// like a real logged-in user reusing their token.
//
// Safety: creates ONE throwaway user via the Supabase admin API (no welcome
// email / trial side-effects), runs modest read-only bursts, ABORTS the ramp at
// the first sign of strain, then DELETES the throwaway user.
//
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
//   bun run src/scripts/loadtest-db.ts
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY from backend/.env (Bun auto-loads).

const BASE     = process.env.LOADTEST_BASE_URL ?? 'http://localhost:4000'
const SB_URL   = process.env.SUPABASE_URL!
const SB_SVC   = process.env.SUPABASE_SERVICE_KEY!
const SB_ANON  = process.env.SUPABASE_ANON_KEY!
const WEBHOOK  = process.env.SLACK_WEBHOOK_URL
const ENDPOINT = '/projects'                       // DB-backed read (dashboard load)

const STEPS = [5, 10, 20, 40]                       // concurrency rungs
const PER_STEP = 400                                // requests per rung
const ABORT_5XX_PCT = 2                             // stop ramp if a rung exceeds this

if (!SB_URL || !SB_SVC || !SB_ANON) { console.error('Missing SUPABASE_* env (run from backend/ so .env loads)'); process.exit(1) }

const rnd = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a
const randomIp = () => `${rnd(1, 223)}.${rnd(0, 255)}.${rnd(0, 255)}.${rnd(1, 254)}`
const pct = (s: number[], p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0)

interface Res { status: number; ms: number }
let TOKEN = ''

async function hit(): Promise<Res> {
  const t0 = performance.now()
  try {
    const r = await fetch(BASE + ENDPOINT, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': randomIp() },
    })
    await r.text()
    return { status: r.status, ms: performance.now() - t0 }
  } catch { return { status: 0, ms: performance.now() - t0 } }
}

async function runRung(total: number, concurrency: number) {
  const res: Res[] = []
  let next = 0
  const t0 = performance.now()
  const worker = async () => { for (;;) { const n = next++; if (n >= total) break; res.push(await hit()) } }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const seconds = (performance.now() - t0) / 1000
  const lat = res.map(r => r.ms).sort((a, b) => a - b)
  const cls = (lo: number, hi: number) => res.filter(r => r.status >= lo && r.status <= hi).length
  return {
    concurrency, total: res.length, seconds: +seconds.toFixed(1),
    rps: +(res.length / seconds).toFixed(0),
    s2xx: cls(200, 299), s429: cls(429, 429), s5xx: cls(500, 599), neterr: res.filter(r => r.status === 0).length,
    p50: +pct(lat, 50).toFixed(0), p95: +pct(lat, 95).toFixed(0), p99: +pct(lat, 99).toFixed(0), max: +(lat.at(-1) ?? 0).toFixed(0),
  }
}
type Rung = Awaited<ReturnType<typeof runRung>>

async function createUser() {
  const email = `loadtest-${Date.now()}@example.com`, password = `Lt!${Math.random().toString(36).slice(2)}Aa9`
  const cr = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!cr.ok) throw new Error(`createUser failed: ${cr.status} ${await cr.text()}`)
  const id = (await cr.json()).id
  const si = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!si.ok) throw new Error(`signIn failed: ${si.status} ${await si.text()}`)
  TOKEN = (await si.json()).access_token
  return id
}

async function deleteUser(id: string) {
  await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}` } }).catch(() => {})
}

async function main() {
  console.log(`DB load test → ${BASE}${ENDPOINT}  (ramped, read-only, prod Supabase)\n`)
  const userId = await createUser()
  console.log('throwaway user created + signed in\n')

  const rungs: Rung[] = []
  let aborted = false
  try {
    // Warm the auth cache + connection once so step 1 isn't skewed by cold start.
    await hit()
    for (const c of STEPS) {
      const r = await runRung(PER_STEP, c)
      rungs.push(r)
      console.table(r)
      const bad = r.s5xx + r.neterr
      if ((bad / r.total) * 100 > ABORT_5XX_PCT) { console.log(`\n⚠ aborting ramp — ${bad} errors at ${c} concurrency`); aborted = true; break }
    }
  } finally {
    await deleteUser(userId)
    console.log('\nthrowaway user deleted')
  }

  const alive = (await hit()).status === 200
  const totalErr = rungs.reduce((n, r) => n + r.s5xx + r.neterr, 0)
  const pass = totalErr === 0 && alive && !aborted
  // Latency growth across the ramp = how the DB copes as load rises.
  const first = rungs[0], last = rungs.at(-1)!
  console.log(pass ? '\n✅ PASS — DB read path stable across the ramp' : '\n❌ FAIL / strained — see rungs above')

  if (WEBHOOK) { await postSlack(pass, rungs, alive, aborted, first, last); console.log('Posted DB report to Slack.') }
  else console.log('\n(no SLACK_WEBHOOK_URL — skipped Slack post)')
  process.exit(pass ? 0 : 1)
}

async function postSlack(pass: boolean, rungs: Rung[], alive: boolean, aborted: boolean, first: Rung, last: Rung) {
  const row = (r: Rung) => `   ${r.concurrency} conc → ${r.rps} req/s · p50 ${r.p50}ms · p95 ${r.p95}ms · p99 ${r.p99}ms · 5xx ${r.s5xx} · err ${r.neterr}`
  const text =
    `${pass ? '✅' : '❌'} *Dizko DB load test — ${pass ? 'PASS' : aborted ? 'STRAINED (ramp aborted)' : 'FAIL'}*\n` +
    `target: \`${BASE}${ENDPOINT}\` (real Supabase, read-only)\n\n` +
    `*Latency as load rises:*\n` + rungs.map(row).join('\n') +
    `\n\n*Read:* p95 went ${first.p95}ms → ${last.p95}ms as concurrency rose ${first.concurrency}→${last.concurrency}. ` +
    `Server alive after: ${alive ? '✅' : '❌'}.\n` +
    `_Note: throwaway user had no data, so this is the DB round-trip floor — real users with projects do heavier queries._`
  await fetch(WEBHOOK!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {})
}

main().catch(e => { console.error(e); process.exit(1) })
