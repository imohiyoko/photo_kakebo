const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { createWorker } = require('tesseract.js');
const FormData = require('form-data');

// Auto-correct dictionary
let autoDict = [];
function loadAutoDict() {
  try {
    const p = path.join(process.cwd(),'db-kakebo','ocr_autocorrect.json');
    if (fs.existsSync(p)) autoDict = JSON.parse(fs.readFileSync(p,'utf8')); else autoDict = [];
  } catch { autoDict = []; }
}
loadAutoDict();
function escapeReg(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function applyAutoDict(text){
  if(!text)return text;
  let out=text;
  autoDict.forEach(e=>{ if(e.from&&e.to){ try { out = out.replace(new RegExp(escapeReg(e.from),'g'), e.to); } catch {} } });
  return out;
}

function splitLines(t){ if(!t) return []; return t.replace(/\r/g,'').split(/\n+/).map(l=>l.trim()).filter(Boolean); }
function majorityVote(strings){ const f={}; strings.forEach(s=>f[s]=(f[s]||0)+1); let best=null,bestCnt=0; Object.entries(f).forEach(([s,c])=>{ if(c>bestCnt){best=s;bestCnt=c;} }); return {value:best,count:bestCnt,total:strings.length}; }
function aggregateOcr(results){ const lineArrays=results.map(r=>splitLines(r.text)); const maxLen=Math.max(...lineArrays.map(a=>a.length)); const merged=[]; const conflicts=[]; for(let i=0;i<maxLen;i++){ const candidates=lineArrays.map(a=>a[i]||'').filter(c=>c.length>0); if(!candidates.length) continue; const vote=majorityVote(candidates); const isConflict=vote.count<2 && candidates.length>=2; merged.push(vote.value); if(isConflict) conflicts.push({ lineIndex:i, candidates }); } return { aggregatedText: merged.join('\n'), mergedLines: merged, conflicts, engines: results.map(r=>r.engine) }; }

function parseOcrText(text){ const result={storeName:null,purchaseDate:null,totalAmount:null}; if(!text) return result; const norm=text.replace(/\r/g,''); const lines=norm.split(/\n+/).map(l=>l.trim()).filter(l=>l); const skipPattern=/領収書|合計|計|¥|￥|税|小計|TEL|電話|〒|http|https|会員|ポイント|有効期限/; for(let i=0;i<Math.min(10,lines.length);i++){ const line=lines[i]; if(!line) continue; if(skipPattern.test(line)) continue; if(/^[0-9¥￥,.\-\s]+$/.test(line)) continue; result.storeName=line.slice(0,80); break; } const zen2han=s=>s.replace(/[０-９]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFF10+0x30)); const datePattern=/(20[0-9]{2})[\/\-年]\s*([0-9０-９]{1,2})[\/\-月]\s*([0-9０-９]{1,2})日?/; const dm=norm.match(datePattern); if(dm){ const y=dm[1]; const m=zen2han(dm[2]).padStart(2,'0'); const d=zen2han(dm[3]).padStart(2,'0'); result.purchaseDate=`${y}-${m}-${d}`; } const amountCandidates=[]; const amountLinePattern=/(?:合計|総計|計)[^\n]{0,20}?([0-9０-９¥￥,. ]{2,})/g; let m1; while((m1=amountLinePattern.exec(norm))!==null){ const raw=zen2han(m1[1]).replace(/[¥￥]/g,'').replace(/[, ]/g,''); if(/^[0-9]{2,}$/.test(raw)) amountCandidates.push(parseInt(raw,10)); } const standalonePattern=/[¥￥]\s*([0-9０-９][0-9０-９, ]{1,})/g; let m2; while((m2=standalonePattern.exec(norm))!==null){ const raw=zen2han(m2[1]).replace(/[, ]/g,''); if(/^[0-9]{2,}$/.test(raw)) amountCandidates.push(parseInt(raw,10)); } const subtotalPattern=/小計[^\n]{0,20}?([0-9０-９, ]{2,})/g; let m3; while((m3=subtotalPattern.exec(norm))!==null){ const raw=zen2han(m3[1]).replace(/[, ]/g,''); if(/^[0-9]{2,}$/.test(raw)) amountCandidates.push(parseInt(raw,10)); } const filtered=amountCandidates.filter(v=>v>0&&v<1000000); if(filtered.length>0){ result.totalAmount=Math.max(...filtered); } return result; }

function extractItemLines(words){ if(!Array.isArray(words)||!words.length) return []; const lines=[]; const sorted=words.slice().sort((a,b)=>((a.bbox[1]+a.bbox[3])/2)-((b.bbox[1]+b.bbox[3])/2)); let current=[]; let lastY=null; const yThreshold=12; for(const w of sorted){ const cy=(w.bbox[1]+w.bbox[3])/2; if(lastY!==null && Math.abs(cy-lastY)>yThreshold && current.length>0){ lines.push(current); current=[]; } current.push(w); lastY=cy; } if(current.length>0) lines.push(current); return lines.map(ws=>{ const sortedLine=ws.slice().sort((a,b)=>a.bbox[0]-b.bbox[0]); const text=sortedLine.map(w=>w.text).join(' '); const priceWord=sortedLine.slice(-1)[0]; const priceMatch=priceWord.text.match(/[0-9０-９,]+/); return { text, price: priceMatch ? priceWord.text.replace(/[,]/g,'') : null, words: sortedLine}; }); }

function llmResolveConflicts(agg){ const lines=agg.mergedLines.slice(); const resolutions=[]; for(const cf of agg.conflicts){ const chosen=cf.candidates.slice().sort((a,b)=>b.length-a.length)[0]||''; resolutions.push({ lineIndex: cf.lineIndex, resolved: chosen, candidates: cf.candidates }); lines[cf.lineIndex]=chosen; } return { resolutions, newText: lines.join('\n') }; }

async function callLLMConflicts(agg){ const backend=(process.env.LLM_BACKEND||'stub').toLowerCase(); const start=Date.now(); if(backend==='stub'||agg.conflicts.length===0){ const r=llmResolveConflicts(agg); return { resolutions: r.resolutions.map(x=>({...x,fallback:true})), text:r.newText, latency:Date.now()-start, fallback:true }; }
 const conflictsPayload=agg.conflicts.map(cf=>{ const before=[]; const after=[]; if(cf.lineIndex>0) before.push(agg.mergedLines[cf.lineIndex-1]); if(cf.lineIndex+1<agg.mergedLines.length) after.push(agg.mergedLines[cf.lineIndex+1]); return { lineIndex: cf.lineIndex, candidates: cf.candidates, contextBefore: before, contextAfter: after }; });
 try {
  if(backend==='transformers'){
    const base=process.env.LLM_API_URL?process.env.LLM_API_URL.replace(/\/$/,''):null; if(!base) throw new Error('LLM_API_URL未設定');
    const resp=await fetch(`${base}/resolve_conflicts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conflicts:conflictsPayload,task:'conflict',model_version:process.env.LLM_MODEL_VERSION||'stub_v0'})});
    const latency=Date.now()-start; if(!resp.ok) throw new Error('LLM service error '+resp.status); const j=await resp.json(); if(!Array.isArray(j.resolutions)) throw new Error('invalid LLM response'); const lines=agg.mergedLines.slice(); j.resolutions.forEach(r=>{ if(r.resolved && r.lineIndex>=0 && r.lineIndex<lines.length) lines[r.lineIndex]=r.resolved; }); return { resolutions:j.resolutions, text:lines.join('\n'), latency, fallback:false };
  } else if (backend==='ollama') {
    const model=process.env.LLM_MODEL||'llama3'; const prompt=conflictsPayload.map(cf=>`CONFLICT line=${cf.lineIndex}\nCANDIDATES:\n${cf.candidates.map((c,i)=>`[${i}] ${c}`).join('\n')}\nPick best index.`).join('\n---\n');
    const resp=await fetch('http://localhost:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,prompt,stream:false})}); const latency=Date.now()-start; if(!resp.ok) throw new Error('ollama error '+resp.status); const j=await resp.json(); const out=j.response||''; const idxRe=/\[(\d+)\]/g; const lines=agg.mergedLines.slice(); const resolutions=[]; let m; let ci=0; while((m=idxRe.exec(out))!==null && ci<conflictsPayload.length){ const chosenIdx=parseInt(m[1],10); const cf=conflictsPayload[ci]; const chosen=cf.candidates[chosenIdx]||cf.candidates[0]; lines[cf.lineIndex]=chosen; resolutions.push({ lineIndex: cf.lineIndex, resolved: chosen, candidates: cf.candidates }); ci++; }
    for(;ci<conflictsPayload.length;ci++){ const cf=conflictsPayload[ci]; const chosen=cf.candidates.slice().sort((a,b)=>b.length-a.length)[0]; lines[cf.lineIndex]=chosen; resolutions.push({ lineIndex: cf.lineIndex, resolved: chosen, candidates: cf.candidates, fallback:true }); }
    return { resolutions, text: lines.join('\n'), latency, fallback:false };
  }
 } catch(e){ const r=llmResolveConflicts(agg); return { resolutions: r.resolutions.map(x=>({...x,fallback:true,error:e.message})), text:r.newText, latency:Date.now()-start, fallback:true }; }
}

async function runTesseract(imagePath){ const worker=await createWorker('jpn'); const { data }=await worker.recognize(imagePath); await worker.terminate(); return applyAutoDict(data.text); }

module.exports={ applyAutoDict, aggregateOcr, parseOcrText, extractItemLines, callLLMConflicts, runTesseract };
