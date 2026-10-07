import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {chromium} from '@playwright/test'
const out=resolve(process.env.SPIKE_OUTPUT||'../../e2e/evidence/concurrent-text')
const prototype=JSON.parse(readFileSync(resolve(out,'prototype-results.json')))
const studio=JSON.parse(readFileSync(resolve(out,'studio-results.json')))
const browser=await chromium.launch({channel:'chrome'}),chrome=browser.version();await browser.close()
const groups=[]
for(const mode of ['lww','yjs','studio-merge3'])for(const shape of ['opposite-ends','same-position','offline']){
  const rows=[...prototype,...studio].filter(r=>r.mode===mode&&r.shape===shape)
  const times=rows.map(r=>r.latencyFromLastKeyMs).filter(Number.isFinite).sort((a,b)=>a-b)
  const recovery=rows.map(r=>r.recoveryMs).filter(Number.isFinite).sort((a,b)=>a-b)
  const quantile=(values,p)=>values.length?values[Math.ceil(values.length*p)-1]:null
  groups.push({mode,shape,n:rows.length,preserved:rows.filter(r=>r.kept&&r.converged).length,persisted:mode==='studio-merge3'?rows.filter(r=>r.persistedBoth).length:null,focusLosses:rows.reduce((n,r)=>n+(r.focusLosses||0),0),p50ms:quantile(times,.5),p95ms:quantile(times,.95),recoveryP95ms:quantile(recovery,.95)})
}
const report={measuredAt:new Date().toISOString(),appCommit:execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim(),node:process.version,chrome,playwright:'1.63.0',yjs:'13.6.27',method:'Two Chrome contexts. Each types four characters at 40 ms/key. 10 trials per online shape, 3 real Studio 10-second-offline trials. Local controls: 10 trials per shape, 200 ms debounce + 100 ms simulated fanout; local offline period 650 ms. Preservation checks equality plus character multiset; only Studio verifies persisted backend value. Latency starts after the last key; offline total includes outage. Small repeated burst workload, not a production load certification. No overlapping deletions or undo in this matrix.',groups,prototype,studio}
writeFileSync(resolve(out,'results.json'),JSON.stringify(report,null,2)+'\n')
writeFileSync(new URL('results-2026-10-07.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({chrome,groups},null,2))
