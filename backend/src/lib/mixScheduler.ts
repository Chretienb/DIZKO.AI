// Debounced auto-mix. A burst of uploads (e.g. a producer dropping a 75-file
// folder) used to trigger analyze + Smart Mix on EVERY file — 75+ redundant
// mixes hammering the backend (each re-downloads all stems + runs ffmpeg).
//
// scheduleSmartMix() collapses that burst into ONE analyze → mix → mix-ready
// notification, fired ~DELAY_MS after the LAST upload in a project settles.
// User-triggered mixes (POST /projects/:id/smart-bounce) still run immediately.

import { runSmartBounce }            from './smartBounce'
import { analyzeProject }            from './aiAnalysis'
import { getProjectMemberIds, notify } from './notificationService'
import { mixReadyEmail }             from './emailTemplates'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const DELAY_MS = 8_000   // wait this long after the last upload before mixing

export function scheduleSmartMix(projectId: string, userId: string) {
  const existing = timers.get(projectId)
  if (existing) clearTimeout(existing)
  timers.set(projectId, setTimeout(() => { void runMix(projectId, userId) }, DELAY_MS))
}

async function runMix(projectId: string, userId: string) {
  timers.delete(projectId)
  try {
    // AI analysis first so mix params are ready for the bounce.
    await analyzeProject(projectId, userId).catch(() => null)
    const result = await runSmartBounce(projectId, userId)
    if (!result) return

    const memberIds = await getProjectMemberIds(projectId).catch(() => [] as string[])
    if (!memberIds.length) return

    const tpl = mixReadyEmail({
      recipientName: '',
      projectTitle:  projectId,   // enriched by notificationService via userId lookup
      stemCount:     result.stem_count,
      listenUrl:     (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim(),
    })
    await notify({
      type:         'mix_ready',
      recipientIds: memberIds,
      title:        'Session mix updated',
      body:         `${result.stem_count} parts mixed — hear the latest version`,
      actorId:      userId,
      projectId,
      actionUrl:    '/',
      dedupKey:     `mix:${projectId}`,
      dedupWindow:  3 * 60_000,
      email:        true,
      emailSubject: tpl.subject,
      emailHtml:    tpl.html,
    }).catch(() => null)
  } catch (e) {
    console.error('[mixScheduler] error:', (e as Error).message)
  }
}
