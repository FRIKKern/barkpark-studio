// Measure the already-built real app separately from the synthetic relay.
// Supply a server using the same dedicated dataset named below. Never production.
import {chromium,expect} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const dataset=process.env.BARKPARK_DATASET
if(!/^e2e-local-[a-z0-9-]+$/.test(dataset||''))throw new Error('Use a dedicated e2e-local-* dataset')
const api=`${process.env.BARKPARK_URL}/w/${process.env.BARKPARK_WORKSPACE}/p/default`
const studio=process.env.STUDIO_URL||'http://localhost:3102'
const token=process.env.BARKPARK_TOKEN
if(!token)throw new Error('BARKPARK_TOKEN required')
const out=resolve(process.env.SPIKE_OUTPUT||'../../e2e/evidence/concurrent-text')
mkdirSync(out,{recursive:true})
const base='Fixture post 14', id='post-14', bag=value=>[...value].sort().join('')
async function request(path,body){
  for(let attempt=0;attempt<4;attempt++){
    const response=await fetch(api+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body&&JSON.stringify(body)})
    if(response.status===429){await new Promise(r=>setTimeout(r,1000*(Number(response.headers.get('retry-after'))||1)));continue}
    if(!response.ok)throw new Error(`Barkpark ${response.status}`)
    return response.json()
  }
  throw new Error('Rate limit did not clear')
}
const reset=()=>request(`/v1/data/mutate/${dataset}`,{mutations:[{patch:{id,type:'post',set:{title:base}}},{publish:{id,type:'post'}}]})
const browser=await chromium.launch({channel:'chrome'}),results=[]
const preflight=process.argv.includes('--preflight')
let trialsStarted=false
try{
  // The API guard alone is insufficient: a different preview server could use
  // production while the reset client uses the test dataset. Check the real UI.
  const check=await browser.newContext(),page=await check.newPage()
  try{await page.goto(`${studio}/vision`);await expect(page.getByRole('combobox',{name:'Dataset',exact:true})).toHaveValue(dataset)}finally{await check.close()}
  console.log(`Verified Studio dataset: ${dataset}`)
  if(!preflight)for(const shape of ['opposite-ends','same-position','offline'])for(let trial=0;trial<(shape==='offline'?3:10);trial++){
    trialsStarted=true
    await reset()
    const contexts=await Promise.all([0,1].map(()=>browser.newContext({viewport:{width:1440,height:900},...(trial===0?{recordVideo:{dir:out,size:{width:1440,height:900}}}:{})})))
    const pages=await Promise.all(contexts.map(c=>c.newPage())),[a,b]=pages
    let record
    try{
      await Promise.all(pages.map(p=>p.goto(`${studio}/structure/post;${id}`)))
      await Promise.all(pages.map(p=>p.locator('html[data-hydrated]').waitFor({state:'attached'})))
      await Promise.all(pages.map(p=>p.waitForFunction(value=>document.querySelector('#title')?.value===value,base)))
      await a.waitForTimeout(400) // live subscriptions established
      await Promise.all(pages.map(p=>p.locator('#title').focus()))
      await a.keyboard.press(shape==='same-position'?'Home':'End');await b.keyboard.press('Home')
      if(shape==='offline'){
        await b.evaluate(()=>window.__dropLive(10000))
        await contexts[1].setOffline(true)
      }
      const start=Date.now()
      await Promise.all([a.keyboard.type(' aaa',{delay:40}),b.keyboard.type('bbb ',{delay:40})])
      const typed=Date.now()
      if(shape==='offline'){await a.waitForTimeout(10000);await contexts[1].setOffline(false)}
      const reconnected=Date.now(),pollStart=Date.now();let values
      do{
        values=await Promise.all(pages.map(p=>p.locator('#title').inputValue()))
        if(values[0]===values[1]&&bag(values[0])===bag(`${base} aaabbb `))break
        await a.waitForTimeout(25)
      }while(Date.now()-pollStart<7000)
      const seen=Date.now(),carets=await Promise.all(pages.map(p=>p.evaluate(()=>({focus:document.activeElement?.id,at:document.querySelector('#title').selectionStart}))))
      const kept=values.every(v=>bag(v)===bag(`${base} aaabbb `)),converged=values[0]===values[1]
      // Do not equate optimistic browser convergence with persisted data.
      await Promise.all(pages.map(p=>p.getByText(/^Saved$/).waitFor({timeout:12000}).catch(()=>{})))
      const persisted=(await request(`/v1/data/doc/${dataset}/post/${id}?perspective=drafts`)).result.title
      record={mode:'studio-merge3',shape,trial,kept,converged,persisted,persistedBoth:bag(persisted)===bag(`${base} aaabbb `),values,focusLosses:carets.filter(c=>c.focus!=='title').length,carets:carets.map(c=>c.at),latencyFromLastKeyMs:kept&&converged?seen-typed:null,recoveryMs:shape==='offline'?seen-reconnected:null,typingMs:typed-start}
      if(trial===0){await a.waitForTimeout(2000);await a.screenshot({path:resolve(out,`studio-${shape}.png`)})}
    }catch(error){record={mode:'studio-merge3',shape,trial,error:String(error)}}finally{
      await Promise.all(contexts.map(c=>c.close()))
      if(trial===0)for(let i=0;i<2;i++)await pages[i].video().saveAs(resolve(out,`studio-${shape}-${i?'B':'A'}.webm`))
    }
    results.push(record);writeFileSync(resolve(out,'studio-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(record))
  }
}finally{await browser.close();if(trialsStarted)await reset()}
