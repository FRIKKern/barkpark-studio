// A localhost-only, in-memory prototype. No production authentication, storage,
// or durability is implied. Both algorithms use identical debounce and fanout.
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import * as Y from 'yjs'

export async function startRelay() {
  const bundle = await build({entryPoints:[fileURLToPath(new URL('client.mjs',import.meta.url))],bundle:true,write:false,format:'esm'})
  const rooms = new Map()
  function roomFor(id) {
    if (!rooms.has(id)) {
      const doc=new Y.Doc(); doc.getText('title').insert(0,'Fixture post 14')
      rooms.set(id,{doc,value:'Fixture post 14',rev:0,listeners:new Set()})
    }
    return rooms.get(id)
  }
  const snapshot=r=>({value:r.value,rev:r.rev,update:Array.from(Y.encodeStateAsUpdate(r.doc))})
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'), room=roomFor(url.searchParams.get('room')||'default')
    if(url.pathname==='/client.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(readFileSync(new URL('index.html',import.meta.url)))}
    if(url.pathname==='/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(snapshot(room)))}
    if(url.pathname==='/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
      res.write(': connected\n\n');room.listeners.add(res);req.on('close',()=>room.listeners.delete(res));return
    }
    if(url.pathname==='/update' && req.method==='POST'){
      const chunks=[];for await(const c of req)chunks.push(c)
      const body=JSON.parse(Buffer.concat(chunks).toString())
      if(body.update){Y.applyUpdate(room.doc,new Uint8Array(body.update));room.value=room.doc.getText('title').toString()}
      else room.value=body.value
      room.rev++
      const event=JSON.stringify(snapshot(room))
      setTimeout(()=>{for(const listener of room.listeners)listener.write(`data: ${event}\n\n`)},100)
      res.setHeader('Content-Type','application/json');return res.end('{}')
    }
    res.writeHead(404);res.end()
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})}
}
