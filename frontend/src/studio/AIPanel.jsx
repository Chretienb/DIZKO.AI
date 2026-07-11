import { useState, useRef } from 'react'
import { Spinner, C } from '../components/ui/index.jsx'
import { buildInsightRows } from './mixInsights.js'

const fmtT = s => `${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`

// Inline player for the generated mix — play/pause + scrub, right in the panel
// (the studio has no bottom bar). Keyed on url so a new mix resets it.
function MixPlayer({ url }) {
  const ref = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const toggle = () => { const a = ref.current; if (!a) return; a.paused ? a.play() : a.pause() }
  const seek = (e) => { const a = ref.current; if (!a || !dur) return; const r = e.currentTarget.getBoundingClientRect(); a.currentTime = ((e.clientX - r.left) / r.width) * dur }
  const pct = dur ? (cur / dur) * 100 : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:11 }}>
      <audio ref={ref} src={url} preload="metadata"
        onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
        onTimeUpdate={e=>setCur(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDur(e.currentTarget.duration||0)} />
      <button onClick={toggle} aria-label={playing?'Pause mix':'Play mix'}
        style={{ width:36, height:36, borderRadius:'50%', border:'none', background:C.coral, color:'#fff', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 3px 10px ${C.coral}55` }}>
        {playing
          ? <svg width={13} height={13} viewBox="0 0 24 24" fill="#fff"><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
          : <svg width={13} height={13} viewBox="0 0 24 24" fill="#fff"><path d="M6 3l15 9-15 9V3z"/></svg>}
      </button>
      <div onClick={seek} style={{ flex:1, height:14, display:'flex', alignItems:'center', cursor:dur?'pointer':'default' }}>
        <div style={{ width:'100%', height:3, borderRadius:2, background:'rgba(var(--fg),.12)', position:'relative' }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${pct}%`, background:C.coral, borderRadius:2 }}/>
          <div style={{ position:'absolute', top:'50%', left:`${pct}%`, transform:'translate(-50%,-50%)', width:9, height:9, borderRadius:'50%', background:C.coral }}/>
        </div>
      </div>
      <span style={{ fontSize:11, fontFamily:'monospace', color:C.t3, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{fmtT(cur)} / {fmtT(dur)}</span>
    </div>
  )
}

const Chevron = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
const Check   = ({size=13}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>

// One simple scope button → Board, All songs, or pick one/several songs.
function ScopePicker({ songs, isSelected, onToggle, onSelectAll, onBoard, boardActive, allActive, count }) {
  const [open, setOpen] = useState(false)
  const label = boardActive ? 'Board' : allActive ? 'All songs' : count > 0 ? `${count} song${count > 1 ? 's' : ''}` : 'Board'
  return (
    <div style={{ position:'relative' }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, width:'100%', height:32, padding:'0 11px',
          fontSize:12.5, fontWeight:500, borderRadius:8, cursor:'pointer',
          border:'none', background:'rgba(var(--fg),.06)', color:C.t1, transition:'all .12s' }}>
        {label} <span style={{ color:C.t3 }}><Chevron/></span>
      </button>
      {open && (
        <>
          <div onClick={()=>setOpen(false)} style={{ position:'fixed', inset:0, zIndex:40 }}/>
          <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, right:0, zIndex:41, maxHeight:260, overflowY:'auto',
            background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:6, boxShadow:'0 10px 34px rgba(0,0,0,.45)' }}>
            <Row label="Board" checked={boardActive} onClick={onBoard}/>
            {songs.length>0 && <Row label="All songs" checked={allActive} onClick={onSelectAll}/>}
            {songs.length>0 && <div style={{ height:1, background:C.border, margin:'5px 4px' }}/>}
            {songs.map(s => <Row key={s.id} label={s.name} checked={isSelected(s.id)} onClick={()=>onToggle(s.id)}/>)}
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, checked, onClick }) {
  return (
    <button onClick={onClick}
      style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, width:'100%', padding:'9px 11px', borderRadius:8, border:'none',
        background:'transparent', cursor:'pointer', textAlign:'left' }}
      onMouseEnter={e=>e.currentTarget.style.background=C.surface2||'rgba(255,255,255,.04)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <span style={{ fontSize:12.5, fontWeight:checked?600:500, color:checked?C.coral:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
      {checked && <span style={{ color:C.coral, flexShrink:0, display:'flex' }}><Check/></span>}
    </button>
  )
}

const IconPlay = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconDl   = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const IconMix  = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1" fill="currentColor" stroke="none"/></svg>

// Smart Mix v2 — "why these takes" + manual override. Shows the AI's per-part
// best-take reasoning; each alternative take is a chip that swaps it into the
// mix (the board), overriding the AI pick.
function MixReasoning({ rows, onPickTake }) {
  if (!rows.length) return null
  return (
    <div style={{ marginBottom:16 }}>
      <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em' }}>Why these takes</p>
      <div style={{ display:'flex', flexDirection:'column', gap:13 }}>
        {rows.map(row => (
          <div key={row.instrument}>
            <span style={{ fontSize:12.5, fontWeight:700, color:C.t1, textTransform:'capitalize' }}>{row.instrument}</span>
            {row.reason && <p style={{ margin:'4px 0 7px', fontSize:12.5, color:C.t2, lineHeight:1.55 }}>{row.reason}</p>}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop: row.reason ? 0 : 6 }}>
              {row.takes.map(t => (
                <button key={t.id}
                  onClick={() => !t.onBoard && onPickTake(row.instrument, t.id)}
                  aria-pressed={t.onBoard}
                  title={t.onBoard ? 'In the mix' : 'Use this take instead'}
                  style={{ display:'flex', alignItems:'center', gap:5, fontSize:11.5, fontWeight:600,
                    padding:'5px 11px', borderRadius:100, cursor:t.onBoard?'default':'pointer',
                    border:`1.5px solid ${t.onBoard ? C.coral : C.border}`,
                    background:t.onBoard ? `${C.coral}1a` : 'transparent',
                    color:t.onBoard ? C.coral : C.t2, transition:'all .15s' }}>
                  {t.isBest && <span aria-hidden="true" title="Top take" style={{ color:t.onBoard ? C.coral : '#f5c97a' }}>★</span>}
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ height:1, background:C.border, margin:'16px 0 0' }}/>
    </div>
  )
}

export default function AIPanel({
  aiAnalysis, smartMixUrl, smartMixInfo,
  smartMixing,
  allStems, boardIds, onPickTake,
  onGenerateMix, onPlayMix,
  mixVersions = [], onRestoreMix,
  openModal, activeProject,
  activeId, dawExporting, onExportDAW,
  exportCount, exportSongs = [], exportSel, exportAllActive,
  onExportBoard, onExportAll, onExportToggleSong,
}) {
  const exportOnBoard = exportSel === 'board'
  const songSelected = (id) => !exportOnBoard && exportSel?.has?.(id)
  const insightRows = buildInsightRows(aiAnalysis?.version_insights, allStems, boardIds)
  const [showVersions, setShowVersions] = useState(false)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* Smart Mix — translucent card (the drawer behind it is glass) */}
      <div style={{ borderRadius:12, background:'rgba(var(--fg),.04)' }}>
        <div style={{ padding:13 }}>
          {/* 1 · Header — title + which version + how many stems */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: smartMixUrl ? 10 : 12 }}>
            <span style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:12, fontWeight:500, color:C.t1, letterSpacing:'-.1px' }}>Smart Mix</span>
              {smartMixUrl&&smartMixInfo?.name&&<span style={{ fontSize:10.5, fontWeight:500, color:C.coral, background:`${C.coral}14`, padding:'2px 7px', borderRadius:100 }}>{smartMixInfo.name}</span>}
            </span>
            {smartMixUrl&&smartMixInfo?.stem_count&&<span style={{ fontSize:11, fontWeight:500, color:C.t3 }}>{smartMixInfo.stem_count} stems</span>}
          </div>

          {/* 2 · The mix itself — the result, front and centre */}
          {smartMixUrl && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
              <div style={{ flex:1, minWidth:0 }}><MixPlayer key={smartMixUrl} url={smartMixUrl} /></div>
              <a href={smartMixUrl} download={`${smartMixInfo?.name||'mix'}.wav`} aria-label="Download Mix"
                style={{ width:36, height:36, borderRadius:10, border:'none', background:'rgba(var(--fg),.05)', display:'flex', alignItems:'center', justifyContent:'center', color:C.t3, textDecoration:'none', flexShrink:0 }}>
                <IconDl size={15}/>
              </a>
            </div>
          )}

          {/* 3 · Heads-up — BPM/key clashes to fix before the next mix */}
          {aiAnalysis?.conflicts?.length>0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
              {aiAnalysis.conflicts.map((c,i)=>(
                <div key={i} style={{ display:'flex', gap:9 }}>
                  <span aria-hidden="true" style={{ width:5, height:5, borderRadius:'50%', background:'#f59e0b', marginTop:6, flexShrink:0 }}/>
                  <span style={{ fontSize:12, color:C.t3, lineHeight:1.5 }}>{c.detail}</span>
                </div>
              ))}
            </div>
          )}

          {/* 4 · Tweak — swap takes to change what the next mix uses */}
          <MixReasoning rows={insightRows} onPickTake={onPickTake} />

          {/* 5 · Action — make the (next) mix. Smart Mix is a paid feature, keyed
              to the PROJECT OWNER's plan — if this project's owner is on the
              free tier, open the upgrade paywall directly instead of letting
              the click round-trip to a 402 first. */}
          <button
            onClick={activeProject && !activeProject.owner_paid ? () => openModal('billing', {}) : onGenerateMix}
            disabled={smartMixing}
            aria-label={activeProject && !activeProject.owner_paid ? 'Upgrade to use Smart Mix' : smartMixUrl ? 'Generate another mix' : 'Generate mix'}
            style={{ width:'100%', height:32, borderRadius:8, border:'none', background:`${C.coral}14`, color:C.coral, fontSize:12.5, fontWeight:500, cursor:smartMixing?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7, opacity:smartMixing?.6:1, transition:'background .15s' }}
            onMouseEnter={e=>{ if(!smartMixing) e.currentTarget.style.background=`${C.coral}24` }} onMouseLeave={e=>{ if(!smartMixing) e.currentTarget.style.background=`${C.coral}14` }}>
            {smartMixing
              ? <><Spinner size={13} color={C.coral}/> Mixing…</>
              : activeProject && !activeProject.owner_paid
                ? <>Upgrade to use Smart Mix</>
                : smartMixUrl
                  ? <><svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Generate again</>
                  : <>Generate mix</>}
          </button>

          {/* 6 · Version history — collapsible; restore the board that made any mix */}
          {mixVersions.length > 1 && (
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
              <button onClick={()=>setShowVersions(v=>!v)} aria-expanded={showVersions}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', border:'none', background:'transparent', cursor:'pointer', padding:0 }}>
                <span style={{ fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:C.t3 }}>Versions · {mixVersions.length}</span>
                <span style={{ color:C.t3, display:'flex', transform: showVersions ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}><Chevron/></span>
              </button>
              {showVersions && (
              <div style={{ display:'flex', flexDirection:'column', gap:7, marginTop:10 }}>
                {mixVersions.map((m, i) => (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:12, fontWeight:600, color: i === 0 ? C.coral : C.t1, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {m.name}{i === 0 ? <span style={{ color:C.t3, fontWeight:500 }}> · current</span> : ''}
                    </span>
                    {m.snapshot ? (
                      <button onClick={() => onRestoreMix(m.snapshot)} title="Restore the board that made this mix"
                        style={{ display:'flex', alignItems:'center', gap:5, height:26, padding:'0 10px', borderRadius:7, cursor:'pointer',
                          border:`1px solid ${C.border}`, background:'transparent', color:C.t2, fontSize:11, fontWeight:600, transition:'all .12s' }}
                        onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral }}
                        onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t2 }}>
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>
                        Load
                      </button>
                    ) : (
                      <span style={{ fontSize:10.5, color:C.t4 }}>no board saved</span>
                    )}
                  </div>
                ))}
              </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Export — translucent card, matching Smart Mix above */}
      <div style={{ background:'rgba(var(--fg),.04)', borderRadius:12, padding:13 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:500, color:C.t1, letterSpacing:'-.1px' }}>Export</span>
          <span style={{ fontSize:11, fontWeight:500, color:C.t3 }}>{exportCount||0} stems</span>
        </div>

        {/* scope — one simple button: Board, All songs, or pick songs */}
        <div style={{ marginBottom:12 }}>
          <ScopePicker
            songs={exportSongs}
            isSelected={songSelected}
            onToggle={onExportToggleSong}
            onSelectAll={onExportAll}
            onBoard={onExportBoard}
            boardActive={exportOnBoard}
            allActive={exportAllActive}
            count={exportOnBoard ? 0 : exportSongs.filter(s => songSelected(s.id)).length}
          />
        </div>

        <button onClick={()=>onExportDAW('all')} disabled={dawExporting||!activeId||!exportCount}
          aria-label="Export for your DAW"
          style={{ width:'100%', height:32, display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            borderRadius:8, border:'none', background:'rgba(var(--fg),.06)', color:C.t1, fontSize:12.5, fontWeight:500,
            cursor:(dawExporting||!activeId||!exportCount)?'default':'pointer', opacity:(dawExporting||!activeId||!exportCount)?.45:1, transition:'opacity .12s' }}>
          {dawExporting ? <><Spinner size={13} color={C.t1}/> Exporting…</> : <><IconDl size={12}/> Export · {exportCount||0} stems</>}
        </button>
        <div style={{ fontSize:10.5, color:C.t3, textAlign:'center', marginTop:7 }}>
          .als + Logic guide + stems
        </div>
      </div>
    </div>
  )
}
