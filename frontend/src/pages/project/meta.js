// Pure formatting helpers + instrument/status metadata maps for ProjectView.
// Extracted from pages/ProjectView.jsx (M2 #10). No React, no component state —
// safe to import anywhere. ProjectView imports the names it uses.

export function fmtDur(secs) {
  if (!secs) return null
  return `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`
}
// Decimal units (1 MB = 1,000,000 bytes) to match what macOS/Windows report,
// so a file the OS calls 31.6 MB isn't shown as 30.1 — the bytes are unchanged.
export function fmtSize(b) {
  if (!b) return null
  if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toFixed(1)} GB`
  if (b >= 1_000_000)     return `${(b / 1_000_000).toFixed(1)} MB`
  if (b >= 1000)          return `${(b / 1000).toFixed(0)} KB`
  return `${b} B`
}
export function parseNotes(f) {
  try { return JSON.parse(f?.notes || '{}') } catch { return {} }
}
export function parseVersionNum(name) {
  if (!name) return null
  const m = name.match(/[_\-\s\.](v|ver)(\d+)(\b|_|\s|$)/i)
  return m ? parseInt(m[2]) : null
}
export function stripVersion(name) {
  if (!name) return ''
  return name.replace(/[_\-\s\.](v|ver)\d+/gi, '').replace(/\.[^.]+$/, '').trim()
}

// Stem title for display — the structured studio name as-is (DISPLAY ONLY).
// The backend builds "Track_StemType_Key_BPM" (e.g. "TEST300_Bass_Amin_103");
// show it verbatim (minus the extension) so producers see the full name, not
// just the type. Falls back to the original filename, then the instrument.
export function stemTitle(f, projectTitle = '') {  // eslint-disable-line no-unused-vars
  const raw = (f?.suggested_name || f?.original_name || '').replace(/\.(wav|mp3|flac|aiff?|m4a|ogg)$/i, '')
  if (raw) return raw
  return f?.instrument ? f.instrument.charAt(0).toUpperCase() + f.instrument.slice(1) : 'Untitled'
}

export const STATUSES = ['In Progress', 'Review', 'New Takes', 'Draft']
export const STATUS_META = s => ({
  'In Progress': { color:'#60a5fa', dot:'#60a5fa',  bg:'rgba(96,165,250,.12)',  border:'rgba(96,165,250,.28)'  },
  'Review':      { color:'#f5c97a', dot:'#f5c97a',  bg:'rgba(245,201,122,.12)', border:'rgba(245,201,122,.28)' },
  'New Takes':   { color:'#E8709A', dot:'#E8709A',  bg:'rgba(232,112,154,.12)', border:'rgba(232,112,154,.28)' },
  'Draft':       { color:'rgba(var(--fg),.45)', dot:'rgba(var(--fg),.22)', bg:'rgba(var(--fg),.05)', border:'rgba(var(--fg),.12)' },
}[s] || { color:'rgba(var(--fg),.45)', dot:'rgba(var(--fg),.22)', bg:'rgba(var(--fg),.05)', border:'rgba(var(--fg),.12)' })

// Light-theme status dot
export function ltDot(status) {
  return { 'In Progress':'#E95A51', 'Review':'#EA9F1E', 'New Takes':'#E8709A', 'Draft':'var(--t3)' }[status] || 'var(--t3)'
}

export const GROUPS = [
  { key:'finals',  label:'FINAL MIX',  instrs:['finals','exports','smart_bounce'] },
  { key:'drums',   label:'DRUMS',      instrs:['drums','beats'] },
  { key:'bass',    label:'BASS / 808', instrs:['bass'] },
  { key:'melody',  label:'MELODY',     instrs:['guitar','keys','synth','harmony'] },
  { key:'vocals',  label:'VOCALS',     instrs:['vocals'] },
  { key:'other',   label:'OTHER',      instrs:['recording','demo','other'] },
]
export function getGroupKey(instr) {
  for (const g of GROUPS) if (g.instrs.includes(instr)) return g.key
  return 'other'
}

// Light-theme badge palette (matches Figma)
export const LT_BADGE = {
  finals:      { label:'Master',       bg:'#EAF6DE', border:'#B8D98A', color:'#2D6B14' },
  exports:     { label:'Export',       bg:'#EAF6DE', border:'#B8D98A', color:'#2D6B14' },
  smart_bounce:{ label:'Smart Mix',    bg:'#EAF6DE', border:'#B8D98A', color:'#2D6B14' },
  drums:       { label:'Drums',        bg:'#FDE8CC', border:'#F8CA88', color:'#7A4E00' },
  beats:       { label:'Beats',        bg:'#FDE8CC', border:'#F8CA88', color:'#7A4E00' },
  bass:        { label:'808',          bg:'#FDE8CC', border:'#F8CA88', color:'#7A4E00' },
  guitar:      { label:'Melody',       bg:'#E8E3FB', border:'#C8C0F0', color:'#4532A0' },
  keys:        { label:'Keys',         bg:'#E8E3FB', border:'#C8C0F0', color:'#4532A0' },
  synth:       { label:'Synth',        bg:'#E8E3FB', border:'#C8C0F0', color:'#4532A0' },
  harmony:     { label:'Harmony',      bg:'#E8E3FB', border:'#C8C0F0', color:'#4532A0' },
  vocals:      { label:'Vocal',        bg:'#F8E0DF', border:'#F0C0BE', color:'#8B1A14' },
  recording:   { label:'Recording',   bg:'#F8E0DF', border:'#F0C0BE', color:'#8B1A14' },
  demo:        { label:'Demo',         bg:'var(--surface-2)', border:'var(--border)', color:'#6B6B78' },
  other:       { label:'Audio',        bg:'var(--surface-2)', border:'var(--border)', color:'#6B6B78' },
}
export function getLtBadge(instr, suggestedName) {
  const b = LT_BADGE[instr] || LT_BADGE.other
  if (instr === 'finals' && /inst(rumental)?/i.test(suggestedName || ''))
    return { label:'Instrumental', bg:'#EAF6DE', border:'#B8D98A', color:'#2D6B14' }
  if (instr === 'vocals' && /ad.?lib/i.test(suggestedName || ''))
    return { label:'Ad Lib', bg:'#D9E8F9', border:'#A8C8F0', color:'#134695' }
  return b
}

export const INSTR_LABELS = {
  vocals:    [['Lead Vocal','#6366f1'], ['Dry','#f59e0b']],
  drums:     [['Drums','#F4937A'],      ['808 kick','#f59e0b']],
  bass:      [['808 Bass','#f59e0b'],   ['Sub Bass','#22c55e']],
  guitar:    [['Melody','#8b5cf6'],     ['Arp synth','#6366f1']],
  keys:      [['Keys','#8b5cf6'],       ['Pad','#6366f1']],
  synth:     [['Synth','#6366f1'],      ['Lead','#8b5cf6']],
  harmony:   [['Harmony','#8b5cf6'],    ['BG Vocal','#6366f1']],
  finals:    [['Master','#22c55e'],     ['Final Mix','#22c55e']],
  exports:   [['Export','#22c55e'],     ['Rendered','#22c55e']],
  recording: [['Recording','#F4937A'], ['Raw','#f59e0b']],
  beats:     [['Beat','#F4937A'],       ['Loop','#f59e0b']],
}
export function bpmGenre(bpm) {
  if (!bpm) return null
  if (bpm < 80)  return ['Slow Jam','#ec4899']
  if (bpm < 95)  return ['R&B','#ec4899']
  if (bpm < 115) return ['Hip-Hop','#8b5cf6']
  if (bpm < 145) return ['Trap','#22c55e']
  return ['EDM','#6366f1']
}
export function getDetectedLabels(file, notes) {
  const base = [...(INSTR_LABELS[file.instrument] || [['Audio','#94a3b8']])]
  const g = bpmGenre(notes.bpm)
  if (g) base.push(g)
  if (notes.key) base.push([`${notes.key}${notes.scale === 'minor' ? 'm' : ''}`, '#22c55e'])
  return base.slice(0, 4)
}
