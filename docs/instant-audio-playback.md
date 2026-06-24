# Instant audio playback — how stems play with no wait

This documents the caching that makes single-stem playback (and "Play all") start
**instantly** in the Studio and on the Project page. It works — do not regress it.

## The problem we fixed

Three separate things were making playback slow:

1. **Presigned-URL cache misses (the big one).** Stem audio lives on Cloudflare
   R2 and is served via **AWS-presigned URLs** (`…/previews/<id>.mp3?X-Amz-Date=…&X-Amz-Signature=…`).
   The signature **changes on every request**, so the project page hands the
   browser a *different* URL string each load. Any cache keyed by the full URL
   therefore **misses on every reload** and re-downloads from R2. Our IndexedDB
   byte-cache existed but never actually hit because of this.
2. **WAV fallback.** If a stem has no MP3 preview (`preview_url` null — uploaded
   before preview-gen, or transcode failed), the player streams the multi-MB
   original WAV. Nothing client-side makes that instant.
3. **Whole-file decode for "Play all".** `decodeAudioData` needs the *entire*
   file before it can play. Decoding originals on click was slow.

## The solution — `frontend/src/lib/audioCache.js`

A shared 3-tier cache, **always keyed by `stableKey(url)`** (origin + path, with
the volatile query string stripped):

```
memory (ArrayBuffer)  →  IndexedDB (survives reloads)  →  network (R2)
```

- **`stableKey(url)`** — the single most important rule: **never key the cache by
  the full signed URL.** Strip the query so the same stem maps to one key across
  reloads. (Pinned by `audioCache.test.js`.)
- **`fetchAudioCached(url, onProgress)`** — returns bytes from memory → IndexedDB
  → network, persisting on a cold miss. Fetch uses the full signed URL; cache uses
  the stable key.
- **`cachedPreviewBlobUrl(url)`** — if the preview's bytes are resident, returns a
  local `blob:` URL. Handing that to an `<audio>` element starts playback with
  **zero network and no decode wait** — this is the "instant" path.
- **`warmPreviewBytes(url)`** — background-fills the cache (no-op if already warm)
  so the *first* click after a page load is instant too.

## Who uses it

- **Studio — single stem** (`previewStem`): plays `cachedPreviewBlobUrl(preview)`
  when warm, else streams the MP3 preview.
- **Studio — Play all** (`playAll` / `preloadDecoded`): decodes previews into a
  Web-Audio `decodedCache` (also keyed by `stableKey`) so every stem is scheduled
  sample-locked and instant.
- **Studio** warms all *visible* stems' previews on open; the board preloader
  decodes board stems.
- **Project page** (`InlineStemPlayer`): same `cachedPreviewBlobUrl` → `<audio>`
  pattern; `ProjectView` warms every stem/mix preview in the background on load.

## Invariants — keep these true

- **Always cache by `stableKey`, never the raw signed URL.** This is what makes it
  work across reloads. Breaking it silently re-introduces the "slow on every load"
  bug.
- Prefer the **MP3 preview**; the WAV is a last resort.
- Playback uses an **`<audio>` element with a `blob:`/preview URL** — it streams
  and starts on `canplay`, unlike `decodeAudioData` which waits for the whole file.

## Known limits (physics, not bugs)

- The **very first** fetch of a never-before-played stem must hit R2 once; it's
  instant on every play afterward (memory, then IndexedDB across reloads).
- A stem with **no `preview_url`** falls back to the WAV and is slow. The real fix
  is a backend backfill that generates MP3 previews for stems missing them.

## Tests

- `frontend/src/lib/audioCache.test.js` — proves two presigned URLs for the same
  stem produce one `stableKey` (the cross-reload cache hit).
- `frontend/src/components/MiniPlayer.test.jsx` — proves the player loads the
  small preview / `blob:` URL (never the WAV) and calls `play()` synchronously.
