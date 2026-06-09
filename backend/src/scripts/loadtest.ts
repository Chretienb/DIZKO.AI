// Load test for the Dizko API — local-first, read-only (GET /health).
//
// Three phases:
//   1. Capacity    — many UNIQUE client IPs (vary X-Forwarded-For) so the
//                    per-IP limiter never trips → measures raw server throughput.
//   2. Rate-limit  — one IP, burst past the 300/min cap → must return 429s,
//                    NOT 5xx (graceful degradation, not a crash).
//   3. Spike       — sudden high concurrency, unique IPs → burst handling.
//
// PASS = zero 5xx, zero network drops, limiter returns 429s, /health still 200
// after. Posts a summary to Slack when SLACK_WEBHOOK_URL is set.
//
//   LOADTEST_BASE_URL=http://localhost:4000 \
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
//   bun run src/scripts/loadtest.ts

const BASE    = process.env.LOADTEST_BASE_URL ?? 'http://localhost:4000'
const WEBHOOK = process.env.SLACK_WEBHOOK_URL
const PATH    = process.env.LOADTEST_PATH ?? '/health'

interface Res { status: number; ms: number; err?: string }

async function hit(headers: Record<string, string>): Promise<Res> {
  const t0 = performance.now()
  try {
    const r = await fetch(BASE + PATH, { headers })
    await r.text()                                   // drain body so the socket frees
    return { status: r.status, ms: performance.now() - t0 }
  } catch (e: any) {
    return { status: 0, ms: performance.now() - t0, err: e?.message ?? 'network' }
  }
}

// Run `total` requests across `concurrency` workers; headerFn builds per-request headers.
async function runPhase(total: number, concurrency: number, headerFn: (n: number) => Record<string, string>) {
  const results: Res[] = []
  let next = 0
  const t0 = performance.now()
  const worker = async () => {
    for (;;) {
      const n = next++
      if (n >= total) break
      results.push(await hit(headerFn(n)))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { results, seconds: (performance.now() - t0) / 1000 }
}

const randomIp = () => `${rnd(1, 223)}.${rnd(0, 255)}.${rnd(0, 255)}.${rnd(1, 254)}`
const rnd = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a
const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0

function summarize(name: string, results: Res[], seconds: number) {
  const lat = results.map(r => r.ms).sort((a, b) => a - b)
  const cls = (lo: number, hi: number) => results.filter(r => r.status >= lo && r.status <= hi).length
  const s2xx = cls(200, 299), s4xx = cls(400, 428) + cls(430, 499), s429 = cls(429, 429)
  const s5xx = cls(500, 599), neterr = results.filter(r => r.status === 0).length
  return {
    name, total: results.length, seconds: +seconds.toFixed(1),
    rps: +(results.length / seconds).toFixed(0),
    s2xx, s429, s4xx, s5xx, neterr,
    p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1),
    p99: +pct(lat, 99).toFixed(1), max: +(lat.at(-1) ?? 0).toFixed(1),
  }
}
type Sum = ReturnType<typeof summarize>

async function main() {
  console.log(`Load test → ${BASE}${PATH}\n`)

  // Phase 1 — capacity (unique IP per request → no rate limiting)
  const p1 = await runPhase(3000, 50, () => ({ 'x-forwarded-for': randomIp() }))
  const s1 = summarize('Capacity (3000 req, 50 conc, unique IPs)', p1.results, p1.seconds)

  // Phase 2 — rate-limit guard (single IP, burst past 300/min)
  const p2 = await runPhase(600, 25, () => ({ 'x-forwarded-for': '203.0.113.7' }))
  const s2 = summarize('Rate-limit guard (600 req, 1 IP)', p2.results, p2.seconds)

  // Phase 3 — spike (high concurrency, unique IPs)
  const p3 = await runPhase(4000, 200, () => ({ 'x-forwarded-for': randomIp() }))
  const s3 = summarize('Spike (4000 req, 200 conc, unique IPs)', p3.results, p3.seconds)

  // Liveness — is it still up after the beating?
  const alive = (await hit({ 'x-forwarded-for': randomIp() })).status === 200

  const phases = [s1, s2, s3]
  const crashes  = phases.reduce((n, p) => n + p.s5xx + p.neterr, 0)
  const limiterOk = s2.s429 > 0                              // limiter actually fired
  const pass = crashes === 0 && alive && limiterOk

  for (const p of phases) console.table(p)
  console.log(`\nStill alive after: ${alive ? 'yes' : 'NO'} | limiter fired: ${limiterOk ? 'yes' : 'NO'}`)
  console.log(pass ? '\n✅ PASS — no crashes, limiter graceful, server alive' : '\n❌ FAIL — see above')

  if (WEBHOOK) { await postSlack(pass, phases, alive, limiterOk); console.log('Posted summary to Slack.') }
  else console.log('\n(no SLACK_WEBHOOK_URL set — skipped Slack post)')

  process.exit(pass ? 0 : 1)
}

async function postSlack(pass: boolean, phases: Sum[], alive: boolean, limiterOk: boolean) {
  const row = (p: Sum) =>
    `*${p.name}*\n` +
    `   ${p.rps} req/s · p50 ${p.p50}ms · p95 ${p.p95}ms · p99 ${p.p99}ms · max ${p.max}ms\n` +
    `   2xx ${p.s2xx} · 429 ${p.s429} · 4xx ${p.s4xx} · *5xx ${p.s5xx}* · net-err ${p.neterr}`
  const text =
    `${pass ? '✅' : '❌'} *Dizko API load test — ${pass ? 'PASS' : 'FAIL'}*\n` +
    `target: \`${BASE}${PATH}\`\n\n` +
    phases.map(row).join('\n\n') +
    `\n\nserver alive after: ${alive ? '✅' : '❌'} · rate-limiter graceful: ${limiterOk ? '✅' : '❌'}`
  await fetch(WEBHOOK!, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

main().catch(e => { console.error(e); process.exit(1) })
