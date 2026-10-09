import {AvatarRenderer} from './renderer.js';
const $=s=>document.querySelector(s),canvas=$('#avatar'),ctx=canvas.getContext('2d');
let emotion='neutral',visible=true,enabled=false,audio=null,current=null,blink=false,demoTimer=null,playGeneration=0,audioContext=null,characterId=null,voiceId=null,renderer=null;
const cells={neutral:0,happy:1,angry:2,sad:3,joy:4},rendererCache=new Map();
const characters=await(await fetch('/api/characters')).json();
let voices=await(await fetch('/voices.json')).json();
try{voices=await(await fetch('/api/voices')).json()}catch{for(const v of voices)v.styles=[{name:'ノーマル'}]}
function option(id,name){const o=document.createElement('option');o.value=id;o.textContent=name;return o}
$('#character').replaceChildren(...characters.map(c=>{const o=option(c.id,c.available?c.name:c.name+'（立ち絵なし）');o.disabled=!c.available;return o}));
$('#voice').replaceChildren(...voices.map(v=>option(v.id,v.name)));
function setVoice(id){if(!id)return;const v=voices.find(v=>v.id===id);if(!v)return;const changed=voiceId!==id;voiceId=id;$('#voice').value=id;if(changed)$('#style').replaceChildren(...(v.styles||[]).map(s=>option(s.name,s.name)));$('#credit').textContent='生成イラスト · 音声：VOICEVOX:'+v.name;}
function createCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
async function setCharacter(id){
 if(!id)return;if(id===characterId&&renderer)return;
 const character=characters.find(c=>c.id===id);if(!character)throw Error('Unknown character');
 const previous=characters.find(c=>c.id===characterId);if(!characterId||$('#text').value===previous?.sample)$('#text').value=character.sample;if(!current)$('#subtitle').textContent=character.name+'のプレビューです。';
 if(characterId!==id)setVoice(character.voice);characterId=id;renderer=null;document.body.dataset.character=id;$('#character').value=id;

 $('#avatar').setAttribute('aria-label',character.name+'のプレビュー');
 if(!rendererCache.has(id))rendererCache.set(id,new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(new AvatarRenderer(image,character.face,createCanvas));image.onerror=()=>reject(Error('キャラクター画像を読み込めませんでした'));image.src=character.sprite}));
 const ready=await rendererCache.get(id);if(characterId===id)renderer=ready;
}
await setCharacter((characters.find(c=>c.available)||characters[0]).id);
function triggerBlink(duration=160){blink=true;setTimeout(()=>blink=false,duration)}
function message(s,error=false){$('#message').textContent=s;$('#message').classList.toggle('error',error)}
async function api(route,data){const r=await fetch('/api/'+route,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const j=await r.json();if(!r.ok)throw Error(j.error);return j}
function setEmotion(e){emotion=e;document.body.dataset.emotion=e;document.querySelectorAll('[data-emotion]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.emotion===e)))}
function stop(){playGeneration++;if(audio){audio.pause();audio=null}current=null;document.body.dataset.speaking='false';document.body.dataset.vowel='sil'}
function draw(){ctx.clearRect(0,0,512,512);let vowel='sil';if(audio&&!audio.paused&&current){for(const f of current.timeline){if(f.time>audio.currentTime)break;vowel=f.vowel}}document.body.dataset.vowel=vowel;document.body.dataset.blink=String(blink);if(renderer&&visible)renderer.draw(ctx,{emotion,blink,vowel});requestAnimationFrame(draw)}draw();setInterval(triggerBlink,3900);$('#blink').onclick=()=>triggerBlink(700);
$('#voice').onchange=async()=>{stop();const id=$('#voice').value;setVoice(id);try{await api('command',{action:'voice',voice:id})}catch(e){message(e.message,true)}};
$('#character').onchange=async()=>{stop();const id=$('#character').value;try{const ready=setCharacter(id);await api('command',{action:'character',character:id});await ready}catch(e){message(e.message,true)}};
$('#enable').onclick=async()=>{try{const AC=window.AudioContext||window.webkitAudioContext;const ac=audioContext||(audioContext=new AC());await ac.resume();const b=ac.createBufferSource();b.buffer=ac.createBuffer(1,1,22050);b.connect(ac.destination);b.start();enabled=true;$('#enable').textContent='✓ 音声が有効です';$('#enable').classList.add('enabled');await api('ready',{enabled:true});message('準備できました。「話してみる」を押してください。')}catch(e){message(e.message,true)}};
async function play(s){
 stop();const generation=playGeneration;await setCharacter(s.character);if(generation!==playGeneration)return;setVoice(s.voice);setEmotion(s.emotion);$('#subtitle').textContent=s.text;
 if(!enabled||!audioContext){message('発話を受信しました。「音声を有効にする」を押してから再度指示してください。',true);await api('playback',{id:s.id,status:'blocked'});return}
 let phase='fetch';
 try{
  const response=await fetch(s.audio,{cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();if(generation!==playGeneration)return;
  phase='decode';const buffer=await audioContext.decodeAudioData(bytes);if(generation!==playGeneration)return;
  phase='resume';await audioContext.resume();if(generation!==playGeneration)return;
  if(audioContext.state!=='running')throw Error('ブラウザの音声許可を再度有効にしてください');
  const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);
  const startedAt=audioContext.currentTime;let paused=false;
  audio={get paused(){return paused},get currentTime(){return Math.max(0,audioContext.currentTime-startedAt)},pause(){if(!paused){paused=true;source.stop()}source.disconnect()}};
  current=s;source.onended=async()=>{if(generation!==playGeneration)return;stop();message('再生が終わりました。');await api('playback',{id:s.id,status:'ended',duration:buffer.duration})};
  source.start();document.body.dataset.speaking='true';message(characters.find(c=>c.id===characterId).name+'が話しています。');await api('playback',{id:s.id,status:'playing',duration:buffer.duration});
 }catch(e){
  if(generation!==playGeneration)return;stop();
  const label={fetch:'音声ファイルを取得できませんでした',decode:'音声をデコードできませんでした',resume:'音声を有効にして再試行してください'}[phase];
  message(`${label}（${e.message}）`,true);await api('playback',{id:s.id,status:phase==='resume'?'blocked':'error',phase,error:e.message});
 }
}
const events=new EventSource('/api/events');events.onopen=()=>{if(enabled){api('ready',{enabled:true});message('接続できました。発話を試せます。')}else message('最初に「音声を有効にする」を押してください。')};events.onmessage=e=>{const s=JSON.parse(e.data);if(s.type==='speech')play(s);else if(s.type==='stop')stop();else {setCharacter(s.character).catch(e=>message(e.message,true));setVoice(s.voice);setEmotion(s.emotion);visible=s.visible}};events.onerror=()=>message('表示サーバーへの再接続を待っています。',true);
$('#emotions').onclick=async e=>{if(e.target.dataset.emotion)try{await api('command',{action:'emotion',emotion:e.target.dataset.emotion})}catch(e){message(e.message,true)}};
$('#speak').onclick=async()=>{if(!enabled){message('最初に「音声を有効にする」を押してください。',true);return}$('#speak').disabled=true;message('VOICEVOXで音声を生成しています…');try{await api('command',{action:'speak',character:characterId,voice:voiceId,text:$('#text').value,emotion,style:$('#style').value,speed:Number($('#speed').value)})}catch(e){message(e.message,true)}finally{$('#speak').disabled=false}};
$('#stop').onclick=()=>{clearInterval(demoTimer);stop();api('command',{action:'stop'});message('停止しました。')};$('#demo').onclick=()=>{clearInterval(demoTimer);let i=0;const list=Object.keys(cells);api('command',{action:'emotion',emotion:list[i++]});demoTimer=setInterval(()=>{if(i===list.length){clearInterval(demoTimer);return}api('command',{action:'emotion',emotion:list[i++]})},1100)};
async function status(){try{const s=await api('status');$('#connection').textContent=s.voicevoxVersion?`● VOICEVOX ${s.voicevoxVersion} 接続済み`:'○ VOICEVOX 未接続';if(s.error)message('VOICEVOXを起動してください。接続先：127.0.0.1:50021',true)}catch{}}status();setInterval(status,12000);

$('#export').onclick=async()=>{const b=$('#export');b.disabled=true;message('背景透過の動画を書き出しています。しばらくお待ちください…');try{const r=await api('command',{action:'export',character:characterId,voice:voiceId,text:$('#text').value,emotion,motion:$('#motion').value,style:$('#style').value,speed:Number($('#speed').value)});const area=$('#downloads');area.replaceChildren();for(const [label,url] of [['透過MOV',r.downloads.movie],['音声WAV',r.downloads.audio],['まとめてZIP',r.downloads.bundle]]){const a=document.createElement('a');a.href=url;a.download='';a.textContent=label;a.style.marginRight='16px';area.append(a)}message('書き出しました。透過MOVを動画編集ソフトの上のトラックに置いてください。')}catch(e){message(e.message,true)}finally{b.disabled=false}};
