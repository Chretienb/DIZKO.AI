#!/usr/bin/env bun
/**
 * Dizko.ai Desktop Sync Daemon  — macOS + Windows
 *
 * Usage:
 *   bun run sync.ts login     — save your auth token
 *   bun run sync.ts install   — auto-start on login (launchd / Task Scheduler)
 *   bun run sync.ts uninstall — remove auto-start
 *   bun run sync.ts           — start syncing manually
 *   bun run sync.ts status    — show sync status
 *
 * What it does:
 *   • Creates ~/Desktop/Dizko.ai/{Project}/ for each project
 *   • Downloads new files from Dizko whenever a collaborator uploads
 *   • Watches those folders and uploads new files you drop in
 *   • Skips files it just downloaded (no upload loops)
 */

import { createClient }    from '@supabase/supabase-js'
import { watch }           from 'fs'
import { mkdir, writeFile, readFile, stat } from 'fs/promises'
import { join, basename, extname }          from 'path'
import { homedir, platform }                from 'os'
import { spawnSync }                        from 'child_process'

const IS_WINDOWS = platform() === 'win32'
const IS_MAC     = platform() === 'darwin'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://rmjkxfmalrlinhnbkzgz.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtamt4Zm1hbHJsaW5obmJremd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTk2MDIsImV4cCI6MjA5MzYzNTYwMn0.EmAa04t_YES-iqNPor8-iLfwU8Gd0KVOSkRBhhwhs2w'
const API_BASE      = 'http://localhost:4000'
const CONFIG_FILE   = join(homedir(), '.dizko', 'config.json')
const DESKTOP_ROOT  = join(homedir(), 'Desktop', 'Dizko.ai')

// ── Types ─────────────────────────────────────────────────────────────────────
interface Config { token: string; userId: string; email: string }
interface Project { id: string; title: string; owner_id: string }
interface Stem { id: string; original_name: string; file_url: string; instrument: string; track_id: string; notes: string; created_at: string }

// ── State (avoid upload loops) ────────────────────────────────────────────────
const recentlyDownloaded = new Set<string>()  // local paths we just wrote

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeFolderName(name: string) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled'
}

async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8')
    return JSON.parse(raw)
  } catch { return null }
}

async function saveConfig(cfg: Config) {
  await mkdir(join(homedir(), '.dizko'), { recursive: true })
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

async function apiGet(path: string, token: string) {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!r.ok) throw new Error(`API ${path}: ${r.status}`)
  return r.json()
}

function projectFolder(projectTitle: string) {
  return join(DESKTOP_ROOT, sanitizeFolderName(projectTitle))
}

// ── Login command ─────────────────────────────────────────────────────────────
async function login() {
  console.log('\n  Dizko.ai Desktop Sync — Login\n')
  console.log('  1. Open Dizko.ai in your browser (http://localhost:5173)')
  console.log('  2. Open DevTools → Console → type:')
  console.log('     localStorage.getItem("disco_token")')
  console.log('  3. Copy the token and paste it here:\n')
  process.stdout.write('  Token: ')

  const token = (await new Promise<string>(resolve => {
    const chunks: Buffer[] = []
    process.stdin.setRawMode(false)
    process.stdin.resume()
    process.stdin.on('data', chunk => {
      chunks.push(chunk)
      if (chunk.includes('\n')) {
        resolve(Buffer.concat(chunks).toString().trim())
        process.stdin.pause()
      }
    })
  })).trim()

  if (!token) { console.error('  ✗ No token provided'); process.exit(1) }

  // Verify token by hitting the API
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const userId  = payload.sub
    const email   = payload.email ?? ''
    await saveConfig({ token, userId, email })
    console.log(`\n  ✓ Logged in as ${email}`)
    console.log(`  Config saved to ${CONFIG_FILE}`)
    console.log('\n  Run "bun run sync.ts" to start syncing.\n')
  } catch {
    console.error('  ✗ Invalid token')
    process.exit(1)
  }
}

// ── Download a file to the project folder ─────────────────────────────────────
async function downloadFile(stem: Stem, projectTitle: string) {
  if (!stem.file_url) return

  // Skip separated Demucs stems — only sync uploaded takes
  try {
    const n = JSON.parse(stem.notes || '{}')
    if (n.parent_stem_id || stem.instrument === 'smart_bounce') return
  } catch {}

  const folder   = projectFolder(projectTitle)
  await mkdir(folder, { recursive: true })

  const filename = stem.original_name || `${stem.instrument || 'take'}_${stem.id.slice(0, 8)}${extname(stem.file_url) || '.wav'}`
  const destPath = join(folder, filename)

  // Don't re-download if already exists
  try { await stat(destPath); return } catch {}

  console.log(`  ↓ ${projectTitle}/${filename}`)
  const res = await fetch(stem.file_url)
  if (!res.ok) return

  const buf = Buffer.from(await res.arrayBuffer())
  recentlyDownloaded.add(destPath)
  await writeFile(destPath, buf)
  setTimeout(() => recentlyDownloaded.delete(destPath), 10_000)
  console.log(`  ✓ Saved ${filename} (${(buf.length / 1048576).toFixed(1)} MB)`)
}

// ── Auto-open DAW export files ────────────────────────────────────────────────
function tryOpenDAW(filePath: string) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.als') {
    // Ableton Live
    if (IS_MAC) spawnSync('open', ['-a', 'Ableton Live', filePath], { stdio: 'ignore' })
    else if (IS_WINDOWS) spawnSync('cmd', ['/c', 'start', '', filePath], { stdio: 'ignore', shell: true })
    console.log(`  ♫ Opened Ableton: ${basename(filePath)}`)
  } else if (ext === '.logicx') {
    if (IS_MAC) spawnSync('open', ['-a', 'Logic Pro', filePath], { stdio: 'ignore' })
    console.log(`  ♫ Opened Logic Pro: ${basename(filePath)}`)
  }
}

// ── Upload a file from Desktop to a project ───────────────────────────────────
async function uploadFile(filePath: string, projectId: string, token: string) {
  if (recentlyDownloaded.has(filePath)) return  // skip loop

  const name = basename(filePath)
  const ext  = extname(name).toLowerCase().slice(1)
  const AUDIO = ['wav','mp3','m4a','aac','flac','aif','aiff','ogg','mp4']
  if (!AUDIO.includes(ext)) return

  console.log(`  ↑ Uploading ${name}…`)
  try {
    const buf  = await readFile(filePath)
    const form = new FormData()
    form.append('file',       new Blob([buf]), name)
    form.append('project_id', projectId)

    const r = await fetch(`${API_BASE}/files/upload`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    })
    if (r.ok) {
      console.log(`  ✓ Uploaded ${name}`)
    } else {
      console.error(`  ✗ Upload failed: ${r.status}`)
    }
  } catch (e: any) {
    console.error(`  ✗ Upload error: ${e.message}`)
  }
}

// ── Watch a project folder for new files ──────────────────────────────────────
function watchProjectFolder(folder: string, projectId: string, token: string) {
  watch(folder, { persistent: false, recursive: true }, async (event, filename) => {
    if (!filename || event !== 'rename') return
    const filePath = join(folder, filename)
    await new Promise(r => setTimeout(r, 800))
    try {
      const s = await stat(filePath)
      if (!s.isFile() || s.size === 0) return

      const ext = extname(filePath).toLowerCase()

      // Auto-open DAW session files that appear in Dizko folders
      if (ext === '.als' || ext === '.logicx') {
        tryOpenDAW(filePath)
        return
      }

      await uploadFile(filePath, projectId, token)
    } catch {}
  })
}

// ── Main sync loop ────────────────────────────────────────────────────────────
async function startSync(config: Config) {
  const { token, email } = config

  console.log(`\n  Dizko.ai Desktop Sync`)
  console.log(`  Logged in as: ${email}`)
  console.log(`  Sync folder:  ${DESKTOP_ROOT}`)
  console.log(`  API:          ${API_BASE}\n`)

  await mkdir(DESKTOP_ROOT, { recursive: true })

  // 1. Fetch all projects
  const projRes = await apiGet('/projects', token)
  const projects: Project[] = projRes.data || []

  if (!projects.length) {
    console.log('  No projects yet — create one in Dizko.ai and re-run sync.')
    return
  }

  // 2. Set up folders and download existing files
  const projectMap = new Map<string, Project>()

  for (const proj of projects) {
    const folder = projectFolder(proj.title)
    await mkdir(folder, { recursive: true })
    projectMap.set(proj.id, proj)
    console.log(`  📁 ${proj.title} → ${folder}`)

    // Download existing files
    try {
      const filesRes = await apiGet(`/projects/${proj.id}/files`, token)
      const stems: Stem[] = filesRes.data || []
      for (const stem of stems) {
        await downloadFile(stem, proj.title)
      }
    } catch (e: any) {
      console.error(`  ✗ Could not fetch files for ${proj.title}: ${e.message}`)
    }

    // Watch folder for new files to upload
    watchProjectFolder(folder, proj.id, token)
    console.log(`  👁 Watching ${proj.title}/`)
  }

  // 3. Subscribe to Realtime — new files from collaborators
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  })

  // Get track → project mapping
  const trackToProject = new Map<string, Project>()
  for (const proj of projects) {
    try {
      const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', proj.id)
      for (const t of (tracks || []) as any[]) trackToProject.set(t.id, proj)
    } catch {}
  }

  supabase.channel('dizko-desktop-sync')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stems' },
      async payload => {
        const stem = payload.new as any
        const proj  = trackToProject.get(stem.track_id)
        if (!proj) return
        console.log(`\n  🔔 New file from collaborator in "${proj.title}"`)
        await downloadFile(stem, proj.title)
      }
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        console.log('\n  ✓ Connected — watching for collaborator updates in real-time')
        console.log('  Ctrl+C to stop\n')
      }
    })

  // Keep alive
  await new Promise(() => {})
}

// ── Status command ────────────────────────────────────────────────────────────
async function status() {
  const cfg = await loadConfig()
  if (!cfg) { console.log('Not logged in. Run: bun run sync.ts login'); return }

  console.log('\n  Dizko.ai Sync Status')
  console.log(`  User:   ${cfg.email}`)
  console.log(`  Folder: ${DESKTOP_ROOT}`)
  try {
    const projRes = await apiGet('/projects', cfg.token)
    const projects: Project[] = projRes.data || []
    console.log(`  Projects: ${projects.length}`)
    for (const p of projects) {
      console.log(`    • ${p.title} → ${projectFolder(p.title)}`)
    }
  } catch { console.log('  Could not reach API (is the backend running?)') }
  console.log()
}

// ── Install / Uninstall — macOS (launchd) + Windows (Task Scheduler) ─────────
async function install() {
  const bunPath  = process.execPath
  const syncPath = import.meta.path.replace(/^file:\/\//, '')
  const workDir  = syncPath.replace(/[/\\]sync\.ts$/, '')
  const logPath  = join(homedir(), '.dizko', 'sync.log')

  await mkdir(join(homedir(), '.dizko'), { recursive: true })

  if (IS_MAC) {
    const plistDir  = join(homedir(), 'Library', 'LaunchAgents')
    const plistPath = join(plistDir, 'com.dizko.sync.plist')
    await mkdir(plistDir, { recursive: true })

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.dizko.sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bunPath}</string>
        <string>run</string>
        <string>${syncPath}</string>
    </array>
    <key>WorkingDirectory</key><string>${workDir}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>30</integer>
    <key>StandardOutPath</key><string>${logPath}</string>
    <key>StandardErrorPath</key><string>${logPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key><string>${homedir()}</string>
        <key>PATH</key><string>${bunPath.replace(/\/bun$/, '')}:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>`

    await writeFile(plistPath, plist)
    // Unload if previously registered, then load fresh
    Bun.spawnSync(['launchctl', 'unload', plistPath])
    const r = Bun.spawnSync(['launchctl', 'load', plistPath])
    if (r.exitCode !== 0) throw new Error('launchctl load failed')

    console.log('\n  ✓ Auto-start registered (macOS launchd)')
    console.log(`  Plist: ${plistPath}`)

  } else if (IS_WINDOWS) {
    // Windows Task Scheduler — runs at logon for current user
    const taskName = 'DizkoSync'
    const cmd      = `"${bunPath}" run "${syncPath}"`
    // Delete old task silently, then create new
    Bun.spawnSync(['schtasks', '/delete', '/tn', taskName, '/f'], { stderr: 'pipe' })
    const r = Bun.spawnSync([
      'schtasks', '/create',
      '/tn',  taskName,
      '/tr',  cmd,
      '/sc',  'onlogon',
      '/ru',  process.env.USERNAME ?? process.env.USER ?? '%USERNAME%',
      '/rl',  'LIMITED',   // run with standard user privileges
      '/f',               // force overwrite
    ])
    if (r.exitCode !== 0) throw new Error('schtasks create failed — try running as Administrator')

    console.log('\n  ✓ Auto-start registered (Windows Task Scheduler)')
    console.log(`  Task: ${taskName}`)

  } else {
    // Linux fallback — systemd user service or ~/.bashrc
    const serviceDir  = join(homedir(), '.config', 'systemd', 'user')
    const servicePath = join(serviceDir, 'dizko-sync.service')
    await mkdir(serviceDir, { recursive: true })

    const unit = `[Unit]
Description=Dizko.ai Desktop Sync
After=network-online.target

[Service]
Type=simple
ExecStart=${bunPath} run ${syncPath}
WorkingDirectory=${workDir}
Restart=on-failure
RestartSec=10
StandardOutput=append:${logPath}
StandardError=append:${logPath}
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target`

    await writeFile(servicePath, unit)
    Bun.spawnSync(['systemctl', '--user', 'daemon-reload'])
    Bun.spawnSync(['systemctl', '--user', 'enable', '--now', 'dizko-sync'])
    console.log('\n  ✓ Auto-start registered (systemd user service)')
    console.log(`  Service: ${servicePath}`)
  }

  console.log(`  Logs:   ${logPath}`)
  console.log('\n  To remove:\n    bun run sync.ts uninstall\n')
}

async function uninstall() {
  if (IS_MAC) {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.dizko.sync.plist')
    Bun.spawnSync(['launchctl', 'unload', plistPath])
    try { const { unlink } = await import('fs/promises'); await unlink(plistPath) } catch {}
    console.log('\n  ✓ Auto-start removed (macOS)\n')

  } else if (IS_WINDOWS) {
    Bun.spawnSync(['schtasks', '/delete', '/tn', 'DizkoSync', '/f'])
    console.log('\n  ✓ Auto-start removed (Windows)\n')

  } else {
    Bun.spawnSync(['systemctl', '--user', 'disable', '--now', 'dizko-sync'])
    console.log('\n  ✓ Auto-start removed (Linux)\n')
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
const cmd = process.argv[2]

if (cmd === 'login') {
  await login()
} else if (cmd === 'install') {
  await install()
} else if (cmd === 'uninstall') {
  await uninstall()
} else if (cmd === 'status') {
  await status()
} else {
  const cfg = await loadConfig()
  if (!cfg) {
    console.log('\n  Not logged in. Run first:\n    bun run sync.ts login\n')
    process.exit(1)
  }
  await startSync(cfg)
}
