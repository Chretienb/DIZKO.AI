# Dizko.ai Desktop Sync

Keep your Dizko.ai projects in sync on your Desktop — just like Splice.
Works on **macOS**, **Windows**, and **Linux**.

## Requirements

- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash` on Mac/Linux)
- Windows: install Bun from https://bun.sh then run in PowerShell

## Setup (all platforms)

```bash
cd sync
bun install
bun run sync.ts login
```

When prompted, open Dizko.ai → DevTools Console → paste:
```js
localStorage.getItem('disco_token')
```
Copy the token and paste it into the terminal.

## Auto-start on login

```bash
bun run sync.ts install
```

| Platform | Mechanism |
|---|---|
| macOS | `~/Library/LaunchAgents/com.dizko.sync.plist` (launchd) |
| Windows | Task Scheduler (`DizkoSync` task, runs at logon) |
| Linux | `~/.config/systemd/user/dizko-sync.service` |

To remove auto-start:
```bash
bun run sync.ts uninstall
```

## Manual start

```bash
bun run sync.ts
```

## What gets synced

- ✅ Uploaded takes (vocals, beats, demos, recordings)
- ✅ New files dropped into the Desktop folder → uploaded automatically
- ❌ Separated stems (Demucs output) — use Download in the app
- ❌ Smart Mix bounces — use Download in the app

## Logs

```bash
# macOS / Linux
tail -f ~/.dizko/sync.log

# Windows (PowerShell)
Get-Content $env:USERPROFILE\.dizko\sync.log -Wait
```

## Sync folder locations

| Platform | Path |
|---|---|
| macOS | `~/Desktop/Dizko.ai/{Project}/` |
| Windows | `C:\Users\{you}\Desktop\Dizko.ai\{Project}\` |
| Linux | `~/Desktop/Dizko.ai/{Project}/` |
