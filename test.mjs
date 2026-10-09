import assert from 'node:assert/strict';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const base=`http://127.0.0.1:${process.env.AVATAR_STUDIO_PORT||3210}`;
const client=new Client({name:'local-test',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))]}));
// 仮の表示画面：発話を受け取ったら playing を返し、delay ミリ秒後に ended を返す。
function fakeViewer(){const v={heard:[],delay:200,abort:new AbortController()};v.ready=(async()=>{const r=await fetch(base+'/api/events',{signal:v.abort.signal});await fetch(base+'/api/ready',{method:'POST',body:JSON.stringify({enabled:true})});(async()=>{let buf='';try{for await(const chunk of r.body){buf+=Buffer.from(chunk).toString();let i;while((i=buf.indexOf('\n\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);if(!line.startsWith('data: '))continue;const e=JSON.parse(line.slice(6));if(e.type!=='speech')continue;v.heard.push(e.text);const post=status=>fetch(base+'/api/playback',{method:'POST',body:JSON.stringify({id:e.id,status})});await post('playing');setTimeout(()=>post('ended'),v.delay)}}}catch{}})()})();return v}
const rawStatus=(host)=>new Promise((resolve,reject)=>{const u=new URL(base+'/api/status');http.get({hostname:u.hostname,port:u.port,path:u.pathname,headers:{Host:host}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)});
let viewer;
try{const list=await client.listTools();assert.equal(list.tools.length,10);assert.ok(list.tools.every(t=>t.name.startsWith('avatar_')));console.log('PASS MCP initialize and 10 avatar_* tools');
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text)};
const info=await call('avatar_characters');const kuroe=info.characters.find(c=>c.id==='kuroe');assert.ok(kuroe.available);assert.ok(kuroe.spritePath.endsWith('public/assets/kuroe.png'));assert.equal(kuroe.voiceName,'春日部つむぎ');assert.ok(kuroe.face.eyes.length===2);assert.deepEqual(info.sheet.cells,['neutral','happy','angry','sad','joy','blink']);console.log('PASS avatar_characters returns sprite paths, face and sheet layout');
for(const [character,voice] of [['kuroe','tsumugi'],['crab','zundamon']]){const selected=await call('avatar_character',{character});assert.equal(selected.voice,voice)}
let selected=await call('avatar_voice',{voice:'metan'});assert.equal(selected.character,'crab');assert.equal(selected.voice,'metan');await call('avatar_character',{character:'kuroe'});console.log('PASS kuroe and crab default voices and independent voice selection');
const s=await call('avatar_status');assert.ok(s.voicevoxVersion);console.log('PASS VOICEVOX '+s.voicevoxVersion);
for(const emotion of ['neutral','happy','angry','sad','joy']){const r=await call('avatar_emotion',{emotion});assert.equal(r.emotion,emotion)}console.log('PASS all emotions');
await call('avatar_visibility',{visible:false});await call('avatar_visibility',{visible:true});
const r=await call('avatar_speak',{text:'こんにちは、くろえです。MCPからつながりました。',emotion:'happy'});assert.ok(r.bytes>1000);const wav=await(await fetch(r.audio)).arrayBuffer();assert.equal(Buffer.from(wav).toString('ascii',0,4),'RIFF');if(!r.viewerConnected)assert.equal(r.playback.status,'no-viewer');console.log('PASS MCP speech / WAV / viewer connected:',r.viewerConnected);
const head=await fetch(r.audio,{method:'HEAD'});assert.equal(Number(head.headers.get('content-length')),wav.byteLength);assert.equal((await head.arrayBuffer()).byteLength,0);
const range=await fetch(r.audio,{headers:{Range:'bytes=0-1'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),`bytes 0-1/${wav.byteLength}`);assert.equal(Buffer.from(await range.arrayBuffer()).toString('ascii'),'RI');
const suffix=await fetch(r.audio,{headers:{Range:'bytes=-2'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,2);
const invalid=await fetch(r.audio,{headers:{Range:'bytes=999999999-'}});assert.equal(invalid.status,416);console.log('PASS audio HEAD / byte ranges / suffix / invalid range');

// 口パクの時刻は WAV の長さに合わせて伸縮してある（最後の母音の終わり＋後ろの無音＝WAV の長さ）。
const lip=await(await fetch(base+'/api/command',{method:'POST',body:JSON.stringify({action:'speak',text:'口パクの長さを確かめます。',renderOnly:true})})).json();const last=lip.timeline.at(-1).time;assert.ok(last<lip.duration&&last>lip.duration-0.5,`timeline end ${last} vs wav ${lip.duration}`);assert.ok(lip.timeline.every((f,i,a)=>!i||f.time>=a[i-1].time));console.log(`PASS lip-sync timeline fitted to WAV (${last.toFixed(2)}s of ${lip.duration.toFixed(2)}s)`);

viewer=fakeViewer();await viewer.ready;viewer.delay=2000;
const a=await call('avatar_speak',{character:'crab',text:'ひとつめなのだ。'});const b=await call('avatar_speak',{character:'kuroe',text:'ふたつめです。',queue:true});assert.equal(b.playback.status,'waiting');assert.equal(b.queuePosition,1);
const c=await call('avatar_speak',{character:'crab',text:'みっつめなのだ。',queue:true,wait:true});assert.equal(c.playback.status,'ended');assert.deepEqual(viewer.heard.slice(-3),['ひとつめなのだ。','ふたつめです。','みっつめなのだ。']);console.log('PASS queue keeps order and wait returns after playback ended');
viewer.delay=3000;const d=await call('avatar_speak',{text:'とちゅうで止めます。'});const e2=await call('avatar_speak',{text:'これは流れません。',queue:true});await call('avatar_stop');const after=await(await fetch(base+'/api/status')).json();assert.equal(after.queueLength,0);assert.equal(after.speech,null);assert.ok(!viewer.heard.includes('これは流れません。'));console.log('PASS stop clears the queue');
viewer.abort.abort();

const bad=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'speak',text:'test',speed:99})});assert.equal(bad.status,400);
const origin=await fetch(base+'/api/command',{method:'POST',headers:{Origin:'https://example.com'},body:'{}'});assert.equal(origin.status,403);
assert.equal(await rawStatus('evil.example:3210'),403);assert.equal(await rawStatus(new URL(base).host),200);console.log('PASS invalid inputs, cross-origin and foreign Host rejection');
const down=await call('avatar_shutdown');assert.ok(down.ok);await new Promise(r=>setTimeout(r,400));await assert.rejects(fetch(base+'/api/status',{signal:AbortSignal.timeout(800)}));console.log('PASS avatar_shutdown stops the viewer server');
}catch(e){process.exitCode=1;console.error(e)}finally{viewer?.abort.abort();await client.close();process.exit()}
