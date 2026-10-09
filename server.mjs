import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {exportClip,wavInfo} from './export.mjs';
import {readFile,writeFile,mkdir,readdir,stat,unlink,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.AVATAR_STUDIO_PORT||3210),base=`http://127.0.0.1:${port}`;
const vv=process.env.VOICEVOX_URL||'http://127.0.0.1:50021';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(vv).hostname))throw Error('VOICEVOX_URL must be loopback');
const characters=JSON.parse(await readFile(path.join(root,'public/characters.json'),'utf8'));
const voices=JSON.parse(await readFile(path.join(root,'public/voices.json'),'utf8'));
const audioDir=path.join(root,'public/audio'),keepAudio=Number(process.env.AVATAR_STUDIO_KEEP_AUDIO||100);
async function hasSprite(c){try{await access(path.join(root,'public',c.sprite));return true}catch{return false}}
async function characterList(){return Promise.all(characters.map(async c=>({...c,available:await hasSprite(c)})))}
const firstAvailable=(await characterList()).find(c=>c.available)?.id||characters[0].id;
const clients=new Map();let revision=0;const state={character:firstAvailable,voice:characters.find(c=>c.id===firstAvailable).voice,emotion:'neutral',visible:true,speech:null,lastPlayback:null};
const emotions=['neutral','happy','angry','sad','joy'];
// 再生の状態（id ごと）と、順番待ちの発話。terminal に入った発話は、次の発話に場所を譲る。
const playbacks=new Map(),waiters=new Map(),queue=[],terminal=['ended','stopped','error','blocked','cancelled','no-viewer'];
function send(res,data,status=200,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data)}
function emit(event){for(const res of clients.keys())res.write(`data: ${JSON.stringify(event)}\n\n`)}
async function voice(route,body){const r=await fetch(vv+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error(`VOICEVOX ${r.status}: ${(await r.text()).slice(0,300)}`);return r}
// 音声クエリの長さから母音の時刻を作り、最後に実際の WAV の長さに合わせて全体を伸縮する（前後の無音の扱いでずれが溜まらないように）。
function timeline(q,duration){let t=q.prePhonemeLength/q.speedScale;const out=[{time:0,vowel:'sil'}];for(const a of q.accent_phrases){for(const m of [...a.moras,...(a.pause_mora?[a.pause_mora]:[])]){if(m.consonant_length)t+=m.consonant_length/q.speedScale;out.push({time:t,vowel:m.vowel.toLowerCase()});t+=m.vowel_length/q.speedScale} }out.push({time:t,vowel:'sil'});const total=t+q.postPhonemeLength/q.speedScale,k=duration>0&&total>0?duration/total:1;return out.map(f=>({time:Math.round(f.time*k*10000)/10000,vowel:f.vowel}))}
function setPlayback(id,info){playbacks.delete(id);playbacks.set(id,{id,...info});if(playbacks.size>200)playbacks.delete(playbacks.keys().next().value);if(terminal.includes(info.status)){for(const resolve of waiters.get(id)||[])resolve(playbacks.get(id));waiters.delete(id)}}
function waitFor(id,ms){const p=playbacks.get(id);if(p&&terminal.includes(p.status))return Promise.resolve(p);return new Promise(resolve=>{const list=waiters.get(id)||[];waiters.set(id,list);const timer=setTimeout(()=>resolve({...playbacks.get(id),id,waitTimedOut:true}),ms);list.push(p=>{clearTimeout(timer);resolve(p)})})}
function present(s){state.character=s.character;state.voice=s.voice;state.emotion=s.emotion;const {emotion,...speech}=s;state.speech=speech;state.lastPlayback={id:s.id,status:'queued'};setPlayback(s.id,{status:'queued'});
 if(!clients.size)return finish(s.id,{status:'no-viewer'});emit({type:'speech',emotion,...speech})}
function finish(id,info){setPlayback(id,info);state.lastPlayback={id,...info};if(state.speech?.id!==id)return;state.speech=null;const next=queue.shift();if(next)present(next)}
function interrupt(){for(const s of queue.splice(0))setPlayback(s.id,{status:'stopped'});if(state.speech){const id=state.speech.id;state.speech=null;setPlayback(id,{status:'stopped'});state.lastPlayback={id,status:'stopped'}}emit({type:'stop'})}
async function pruneAudio(){try{const keep=new Set([state.speech?.id,...queue.map(s=>s.id)]);const files=await Promise.all((await readdir(audioDir)).filter(f=>f.endsWith('.wav')&&!keep.has(f.slice(0,-4))).map(async f=>({f,t:(await stat(path.join(audioDir,f))).mtimeMs})));files.sort((a,b)=>b.t-a.t);for(const {f} of files.slice(keepAudio))await unlink(path.join(audioDir,f)).catch(()=>{})}catch{}}
async function command(a){
 if(a.action==='characters')return {characters:(await characterList()).map(c=>({id:c.id,name:c.name,voice:c.voice,voiceName:voices.find(v=>v.id===c.voice)?.name,available:c.available,sprite:c.sprite,spritePath:path.join(root,'public',c.sprite),face:c.face})),sheet:{width:1536,height:1024,columns:3,rows:2,cell:512,cells:['neutral','happy','angry','sad','joy','blink']},voices:voices.map(v=>({id:v.id,name:v.name,credit:'VOICEVOX:'+v.name}))};
 if(a.action==='shutdown'){interrupt();setTimeout(()=>{for(const res of clients.keys())res.end();server.close();process.exit(0)},100);return {ok:true,note:'表示サーバーを停止します。次にツールを使うと自動で起動します。'}}
 const characterId=a.character||state.character;const character=characters.find(c=>c.id===characterId);if(!character)throw Error('Unknown character');const voiceId=a.voice||(a.character?character.voice:state.voice)||character.voice;const selectedVoice=voices.find(v=>v.id===voiceId);if(!selectedVoice)throw Error('Unknown voice');
 if(['character','emotion','speak','export'].includes(a.action)&&!await hasSprite(character))throw Error(`${character.name}の立ち絵（public${character.sprite}）がありません。README の「立ち絵を用意する」を参照してください`);
 if(a.action==='character'){revision++;interrupt();state.character=characterId;state.voice=voiceId;emit({type:'state',...state})}
 else if(a.action==='voice'){revision++;interrupt();state.voice=voiceId;emit({type:'state',...state})}
 else if(a.action==='emotion'){if(!emotions.includes(a.emotion))throw Error('Unknown emotion');state.character=characterId;state.voice=voiceId;state.emotion=a.emotion;emit({type:'state',...state})}
 else if(a.action==='visibility'){state.visible=Boolean(a.visible);emit({type:'state',...state})}
 else if(a.action==='stop'){revision++;interrupt()}
 else if(a.action==='export'){
 if(typeof a.text!=='string'||a.text.length>500)throw Error('Export text must be 1–500 characters');
 const emotion=a.emotion||'neutral',motion=a.motion||'none';if(!['none','nod','bounce','shake'].includes(motion))throw Error('Unknown motion');
 const speech=await command({...a,character:characterId,voice:voiceId,action:'speak',renderOnly:true});return await exportClip(speech,{emotion,motion,style:a.style,speed:a.speed});
 }
 else if(a.action==='speak'){
 if(typeof a.text!=='string'||!a.text.trim()||a.text.length>2000)throw Error('Text must be 1–2000 characters');
 const emotion=a.emotion||state.emotion;if(!emotions.includes(emotion))throw Error('Unknown emotion');
 const speed=Number(a.speed??1);if(!Number.isFinite(speed)||speed<0.5||speed>2)throw Error('Speed must be 0.5–2');
 const speakers=await (await voice('/speakers')).json(),styles=speakers.find(x=>x.name===selectedVoice.name)?.styles.filter(s=>!s.type||s.type==='talk');if(!styles?.length)throw Error(selectedVoice.name+' is unavailable');
 const selected=a.style||'ノーマル',speaker=styles.find(s=>s.name===selected)?.id;if(speaker===undefined)throw Error('Unknown voice style');
 // queue のときは前の発話を止めない。止める（新しい発話・stop・キャラ変更）と revision が進み、生成中のものは取り消される。
 const ticket=a.renderOnly||a.queue?revision:++revision;if(!a.renderOnly&&!a.queue)interrupt();
 const q=await (await voice(`/audio_query?speaker=${speaker}&text=${encodeURIComponent(a.text)}`,{})).json();q.speedScale=speed;
 const wav=Buffer.from(await (await voice(`/synthesis?speaker=${speaker}`,q)).arrayBuffer());if(!a.renderOnly&&ticket!==revision)return {cancelled:true};
 const {duration}=wavInfo(wav),id=randomUUID();await mkdir(audioDir,{recursive:true});await writeFile(path.join(audioDir,id+'.wav'),wav);pruneAudio();
 const speech={id,character:characterId,voice:voiceId,voiceName:selectedVoice.name,text:a.text,audio:`/audio/${id}.wav`,duration,timeline:timeline(q,duration)};
 if(a.renderOnly)return speech;
 const waiting=Boolean(a.queue&&(state.speech||queue.length));if(waiting){queue.push({...speech,emotion});setPlayback(id,{status:'waiting'})}else present({...speech,emotion});
 const result={id,character:characterId,voice:voiceId,voiceName:selectedVoice.name,audio:base+speech.audio,bytes:wav.length,duration,queuePosition:waiting?queue.length:0,viewerConnected:clients.size>0,audioEnabled:[...clients.values()].some(c=>c.enabled)};
 if(!a.wait)return {...result,playback:playbacks.get(id),note:waiting?'順番待ちに入れました。前の発話が終わると再生されます。':'音声を生成して表示画面へ送信しました。再生完了はstatusで確認してください。'};
 // 再生が終わるまで返さない。MCP クライアントの待ち時間を超えないよう 55 秒で切り上げる。
 const ahead=(state.speech?.duration||0)+queue.slice(0,-1).reduce((n,s)=>n+s.duration,0);return {...result,playback:await waitFor(id,Math.min(55000,(ahead+duration+10)*1000))};
 }else throw Error('Unknown action');return {...state,queueLength:queue.length}}
const server=http.createServer(async(req,res)=>{try{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,{error:'Invalid host'},403);
 if(req.headers.origin&&![base,`http://localhost:${port}`].includes(req.headers.origin))return send(res,{error:'Invalid origin'},403);
 const u=new URL(req.url,base);
 if(req.method==='GET'&&u.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});clients.set(res,{enabled:false});res.write(`data: ${JSON.stringify({type:'state',...state})}\n\n`);const ping=setInterval(()=>res.write(': ping\n\n'),15000);req.on('close',()=>{clients.delete(res);clearInterval(ping);if(!clients.size&&state.speech)finish(state.speech.id,{status:'no-viewer'})});return}
 if(u.pathname==='/api/voices'){const speakers=await(await voice('/speakers')).json();return send(res,voices.map(v=>({...v,styles:speakers.find(s=>s.name===v.name)?.styles.filter(s=>!s.type||s.type==='talk')||[]})))}
 if(u.pathname==='/api/characters')return send(res,await characterList());
 if(u.pathname==='/api/status'){let version=null,error=null;try{version=await(await voice('/version')).json()}catch(e){error=e.message}return send(res,{...state,queueLength:queue.length,viewerCount:clients.size,audioEnabled:[...clients.values()].some(c=>c.enabled),voicevoxVersion:version,error})}
 if(req.method==='POST'&&['/api/command','/api/playback','/api/ready'].includes(u.pathname)){let raw='';for await(const b of req){raw+=b;if(raw.length>20000)throw Error('Request too large')}const a=JSON.parse(raw||'{}');if(u.pathname==='/api/ready'){for(const c of clients.values())c.enabled=Boolean(a.enabled);return send(res,{ok:true})}if(u.pathname==='/api/playback'){if(typeof a.id!=='string')throw Error('Missing id');const {id,...info}=a;if(terminal.includes(info.status))finish(id,info);else{setPlayback(id,info);state.lastPlayback=a}return send(res,{ok:true})}return send(res,await command(a))}
 if(!['GET','HEAD'].includes(req.method))return send(res,{error:'Not found'},404);
 const relative=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).replace(/^\/+/,''),file=path.resolve(root,'public',relative);if(!file.startsWith(path.join(root,'public')+path.sep))return send(res,{error:'Forbidden'},403);
 let data;try{data=await readFile(file)}catch{return send(res,{error:'Not found'},404)}const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.wav':'audio/wav','.mov':'video/quicktime','.zip':'application/zip','.json':'application/json'};
 const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
 let start=0,end=data.length-1,status=200;
 if(req.headers.range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if(!match||(!match[1]&&!match[2])){res.writeHead(416,{...headers,'Content-Range':`bytes */${data.length}`,'Content-Length':0});return res.end()}
  if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end}
  else start=Math.max(0,data.length-Number(match[2]));
  if(start>=data.length||start>end||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){res.writeHead(416,{...headers,'Content-Range':`bytes */${data.length}`,'Content-Length':0});return res.end()}
  status=206;headers['Content-Range']=`bytes ${start}-${end}/${data.length}`;
 }
 headers['Content-Length']=end-start+1;res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));
 }catch(e){send(res,{error:e.message},400)}});
server.listen(port,'127.0.0.1',()=>{console.error(`VOICEVOX Avatar Studio: ${base}`);pruneAudio()});
