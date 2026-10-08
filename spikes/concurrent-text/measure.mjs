import {chromium} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {startRelay} from './relay.mjs'

const out=resolve(process.env.SPIKE_OUTPUT||'../../e2e/evidence/concurrent-text')
mkdirSync(out,{recursive:true})
const relay=await startRelay(),browser=await chromium.launch({channel:'chrome'})
const results=[]
const base='Fixture post 14'
const bag=value=>[...value].sort().join('')
try{
  for(const mode of ['lww','yjs'])for(const shape of ['opposite-ends','same-position','offline'])for(let trial=0;trial<10;trial++){
    const room=`${mode}-${shape}-${trial}`
    const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:1100,height:700},...(trial===0?{recordVideo:{dir:out,size:{width:1100,height:700}}}:{})})))
    const pages=await Promise.all(contexts.map(c=>c.newPage()))
    const [a,b]=pages
    let record
    try{
      await Promise.all(pages.map(p=>p.goto(`${relay.url}/?mode=${mode}&room=${room}`)))
      await Promise.all(pages.map(p=>p.waitForFunction(()=>window.ready)))
      await Promise.all(pages.map(p=>p.locator('#title').focus()))
      await a.keyboard.press(shape==='same-position'?'Home':'End');await b.keyboard.press('Home')
      if(shape==='offline')await b.evaluate(()=>window.setOffline(true))
      const start=Date.now()
      await Promise.all([a.keyboard.type(' aaa',{delay:40}),b.keyboard.type('bbb ',{delay:40})])
      const typed=Date.now()
      if(shape==='offline'){
        await a.waitForTimeout(650)
        await b.evaluate(()=>window.setOffline(false))
      }
      const pollStart=Date.now();let values
      do{
        values=await Promise.all(pages.map(p=>p.locator('#title').inputValue()))
        if(values[0]===values[1]&&bag(values[0])===bag(`${base} aaabbb `))break
        await a.waitForTimeout(20)
      }while(Date.now()-pollStart<1800)
      const converged=values[0]===values[1],kept=values.every(v=>bag(v)===bag(`${base} aaabbb `))
      const seen=Date.now()
      const carets=await Promise.all(pages.map(p=>p.evaluate(()=>({focus:document.activeElement?.id,at:document.querySelector('#title').selectionStart,metrics:window.metrics}))))
      record={mode,shape,trial,converged,kept,values,focusLosses:carets.reduce((n,c)=>n+c.metrics.focusLosses+(c.focus!=='title'?1:0),0),carets:carets.map(c=>c.at),latencyFromLastKeyMs:kept&&converged?seen-typed:null,typingMs:typed-start}
      if(trial===0){await a.waitForTimeout(1000);await a.screenshot({path:resolve(out,`${mode}-${shape}.png`)})}
    }finally{
      await Promise.all(contexts.map(c=>c.close()))
      if(trial===0)for(let i=0;i<2;i++)await pages[i].video().saveAs(resolve(out,`${mode}-${shape}-${i?'B':'A'}.webm`))
    }
    results.push(record);writeFileSync(resolve(out,'prototype-results.json'),JSON.stringify(results,null,2))
    console.log(JSON.stringify(record))
  }
}finally{await browser.close();await relay.close()}
