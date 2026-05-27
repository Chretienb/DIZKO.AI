import React from 'react'
import { Spinner, C } from '../components/ui/index.jsx'

const IconPlay = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconDl   = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const IconMix  = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1" fill="currentColor" stroke="none"/></svg>

const DAW_OPTIONS = [
  { id:'all',    label:'All DAWs',     sub:'Ableton + Logic + Universal', icon:'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id:'ableton',label:'Ableton Live', sub:'.als session + embedded stems', icon:'M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4z' },
  { id:'logic',  label:'Logic Pro',    sub:'Logic folder + stem guide', icon:'M9 18V5l12-2v13M6 3v13.5M3 9h3m-3 4h3' },
]

export default function AIPanel({
  aiAnalysis, smartMixUrl, smartMixInfo,
  smartMixing, mixerStems,
  onGenerateMix, onPlayMix,
  openModal, activeProject,
  activeId, dawExporting, onExportDAW,
}) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* AI Mix */}
      <div style={{ borderRadius:24, background:C.surface, border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 4px 24px rgba(0,0,0,.07)' }}>
        <div style={{ padding:'28px 24px 24px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:9 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'#faf9f7', border:'1px solid rgba(0,0,0,.07)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <svg width={22} height={22} viewBox="0 0 100 100" fill="none" aria-hidden="true">
                  {[0,30,60,90,120,150,180,210,240,270,300,330].map((angle,i)=>(
                    <rect key={i} x="46" y="8" width="8" height="36" rx="4" fill="#D97757" transform={`rotate(${angle} 50 50)`} opacity={1-(i%3)*0.08}/>
                  ))}
                </svg>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:'.02em' }}>Claude by Anthropic</div>
                <div style={{ fontSize:18, fontWeight:900, color:C.t1, letterSpacing:'-.6px', lineHeight:1.1 }}>AI Mix</div>
              </div>
            </div>
            {smartMixUrl&&smartMixInfo?.stem_count&&<span style={{ fontSize:11, fontWeight:600, color:'#bbb' }}>{smartMixInfo.stem_count} stems</span>}
          </div>

          {aiAnalysis?.brief && (
            <>
              {/* Brief — clean, no label */}
              <p style={{ margin:'0 0 18px', fontSize:14, color:C.t2, lineHeight:1.8, letterSpacing:'-.01em' }}>
                {aiAnalysis.brief}
              </p>

              {/* Conflicts */}
              {aiAnalysis.conflicts?.length>0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
                  {aiAnalysis.conflicts.map((c,i)=>(
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:9, padding:'10px 13px', borderRadius:10, background:'#fffbeb', border:'1px solid #fde68a' }}>
                      <svg aria-hidden="true" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink:0, marginTop:2 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      <span style={{ fontSize:12.5, color:'#92400e', lineHeight:1.55 }}>{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Missing instruments */}
              {aiAnalysis.missing?.length>0 && (
                <div style={{ marginBottom:16 }}>
                  <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:600, color:'#ccc', textTransform:'uppercase', letterSpacing:'.08em' }}>Add to the session</p>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {aiAnalysis.missing.slice(0,5).map(m=>(
                      <button key={m} onClick={()=>openModal('upload',{project:activeProject})}
                        style={{ fontSize:11.5, fontWeight:600, padding:'5px 13px', borderRadius:100, cursor:'pointer',
                          border:'1.5px solid rgba(0,0,0,.1)', background:C.surface, color:C.t2,
                          textTransform:'capitalize', transition:'all .15s' }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=C.coral;e.currentTarget.style.color=C.coral}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,0,0,.1)';e.currentTarget.style.color='#555'}}>
                        + {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ height:1, background:'rgba(0,0,0,.06)', margin:'16px 0' }}/>
            </>
          )}

          {smartMixUrl ? (
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={onPlayMix} aria-label="Play AI Mix"
                style={{ flex:1, height:48, borderRadius:14, border:'none', background:C.grad, color:'#fff', fontSize:15, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow:`0 8px 28px ${C.coral}35`, letterSpacing:'-.3px' }}>
                <IconPlay size={14} color="#fff"/> Play AI Mix
              </button>
              <a href={smartMixUrl} download="ai_mix.wav" aria-label="Download AI Mix"
                style={{ width:48, height:48, borderRadius:14, border:'1px solid rgba(0,0,0,.09)', background:'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', color:C.t3, textDecoration:'none' }}>
                <IconDl size={15}/>
              </a>
            </div>
          ) : (
            <button onClick={onGenerateMix} disabled={smartMixing||mixerStems.length<1} aria-label="Generate AI Mix with Claude"
              style={{ width:'100%', height:48, borderRadius:14, border:'none', background:mixerStems.length<1?'rgba(0,0,0,.04)':C.grad, color:mixerStems.length<1?'#ccc':'#fff', fontSize:15, fontWeight:800, cursor:mixerStems.length<1?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow:mixerStems.length>=1&&!smartMixing?`0 8px 28px ${C.coral}35`:'none', letterSpacing:'-.3px', transition:'all .2s' }}>
              {smartMixing ? <><Spinner size={14} color="#fff"/> Mixing with Claude…</> : <><IconMix size={14}/> Generate AI Mix</>}
            </button>
          )}
        </div>
      </div>

      {/* Export */}
      <div style={{ background:C.surface, borderRadius:20, padding:'20px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <div aria-hidden="true" style={{ width:32, height:32, borderRadius:10, background:`${C.coral}10`, display:'flex', alignItems:'center', justifyContent:'center' }}><IconDl size={14}/></div>
          <span style={{ fontSize:14, fontWeight:900, color:C.t1, letterSpacing:'-.3px' }}>Export</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          {DAW_OPTIONS.map(opt=>(
            <button key={opt.id} onClick={()=>onExportDAW(opt.id)} disabled={dawExporting||!activeId}
              aria-label={`Export for ${opt.label}`}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:12, border:'1px solid rgba(0,0,0,.07)', background:'rgba(0,0,0,.02)', cursor:dawExporting||!activeId?'default':'pointer', textAlign:'left', transition:'background .12s' }}
              onMouseEnter={e=>{if(!dawExporting)e.currentTarget.style.background='rgba(0,0,0,.05)'}} onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.02)'}>
              <div aria-hidden="true" style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:`${C.coral}10`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={opt.icon}/></svg>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:C.t1 }}>{opt.label}</div>
                <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{opt.sub}</div>
              </div>
              {dawExporting&&<Spinner size={11} color={C.coral}/>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
