import * as Y from 'yjs'
const params=new URLSearchParams(location.search), mode=params.get('mode'), room=params.get('room')
const field=document.querySelector('#title'), status=document.querySelector('#state')
document.querySelector('#mode').textContent=mode==='yjs'?'Yjs prototype':'Last-write-wins control'
const url=path=>`${path}?room=${encodeURIComponent(room)}`
const doc=new Y.Doc(), text=doc.getText('title')
let timer, lastRev=0, offline=false, pending=false
window.metrics={focusLosses:0,remoteUpdates:0}
const relative=()=>Y.createRelativePositionFromTypeIndex(text,field.selectionStart||0,-1)
function receive(data){
  if(offline || data.rev<lastRev)return
  lastRev=data.rev
  const focused=document.activeElement===field, pos=field.selectionStart
  if(mode==='yjs'){
    const caret=relative();Y.applyUpdate(doc,new Uint8Array(data.update),'remote');field.value=text.toString()
    if(focused){const absolute=Y.createAbsolutePositionFromRelativePosition(caret,doc);if(absolute)field.setSelectionRange(absolute.index,absolute.index)}
  }else{
    field.value=data.value
    if(focused)field.setSelectionRange(Math.min(pos,field.value.length),Math.min(pos,field.value.length))
  }
  window.metrics.remoteUpdates++
  if(focused&&document.activeElement!==field)window.metrics.focusLosses++
  status.textContent='Synchronized'
}
async function send(){
  if(offline){pending=true;return}
  pending=false
  const body=mode==='yjs'?{update:Array.from(Y.encodeStateAsUpdate(doc))}:{value:field.value}
  await fetch(url('/update'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
}
const initial=await fetch(url('/state')).then(r=>r.json());receive(initial)
const stream=new EventSource(url('/events'));stream.onmessage=event=>receive(JSON.parse(event.data))
await new Promise(resolve=>{stream.onopen=resolve})
field.disabled=false;window.ready=true
field.addEventListener('input',()=>{
  if(mode==='yjs'){
    const before=text.toString(),after=field.value
    let start=0,end=0
    while(start<before.length&&start<after.length&&before[start]===after[start])start++
    while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++
    doc.transact(()=>{text.delete(start,before.length-start-end);text.insert(start,after.slice(start,after.length-end))},'local')
  }
  status.textContent=offline?'Offline · pending':'Saving…';clearTimeout(timer);timer=setTimeout(send,200)
})
window.setOffline=async value=>{
  offline=value
  if(!offline){
    // Yjs merges the missing remote state before publishing its offline edits.
    // The whole-value control sends its latest value, overwriting remote edits.
    if(mode==='yjs')receive(await fetch(url('/state')).then(r=>r.json()))
    if(pending)await send()
  }
}
