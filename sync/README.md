# Dizko.ai Desktop Sync

Keep your Dizko.ai projects in sync on your Desktop — just like Splice.

## Setup

```bash
cd sync
bun install
bun run sync.ts login
```

When prompted, open Dizko.ai → DevTools Console → paste this:
```js
localStorage.getItem('disco_token')
```
Copy the token and paste it into the terminal.

## Start syncing

```bash
bun run sync.ts
```

This will:
- Create `~/Desktop/Dizko.ai/{Project}/` for each project
- Download all existing files immediately
- Watch Supabase Realtime → download new files as collaborators upload them
- Watch the Desktop folders → upload any files you drop in

## Run in background (Mac)

```bash
nohup bun run sync.ts > ~/.dizko/sync.log 2>&1 &
echo $! > ~/.dizko/sync.pid
```

To stop:
```bash
kill $(cat ~/.dizko/sync.pid)
```

## File rules

- Only audio files are synced: WAV, MP3, M4A, FLAC, AIFF, OGG
- Separated stems (Demucs output) are NOT synced — only uploaded takes
- Smart Mix bounces are NOT synced — use the Download button in the app
- Already-existing files are not re-downloaded
