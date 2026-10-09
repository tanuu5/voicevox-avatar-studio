import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=`http://127.0.0.1:${process.env.AVATAR_STUDIO_PORT||3210}`;
const running=async(ms=1500)=>{try{await fetch(base+'/api/status',{signal:AbortSignal.timeout(ms)});return true}catch{return false}};
async function ensure(){if(await running())return;const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{detached:true,stdio:'ignore',env:process.env});child.unref();for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(await running(500))return}throw Error('Local viewer failed to start')}
const read=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const characters=read('./public/characters.json'),voices=read('./public/voices.json');
const server=new McpServer({name:'voicevox-avatar-studio',version:'2.0.0'});
const character=z.enum(characters.map(c=>c.id));
const voice=z.enum(voices.map(v=>v.id));
const emotion=z.enum(['neutral','happy','angry','sad','joy']);
async function call(action,args={}){await ensure();const r=await fetch(base+(action==='status'?'/api/status':'/api/command'),action==='status'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...args})});const data=await r.json();return {isError:!r.ok,content:[{type:'text',text:JSON.stringify({viewerUrl:base,...data})}]}}
const characterNames=characters.map(c=>`${c.id}=${c.name}（${voices.find(v=>v.id===c.voice)?.name}の声）`).join('、');
server.registerTool('avatar_status',{description:'VOICEVOX接続・表示画面・音声許可・直近の再生結果・順番待ちの数を確認します。',inputSchema:{}},()=>call('status'));
server.registerTool('avatar_characters',{description:'キャラクターの一覧を返します。立ち絵のファイルの場所（spritePath）、立ち絵があるか（available）、顔の位置の数値（face）、表情シートの形（sheet）、声のクレジットを含みます。動画側で同じ立ち絵を描くときに使います。',inputSchema:{}},()=>call('characters'));
server.registerTool('avatar_emotion',{description:'選択したキャラの表情を通常・喜・怒・哀・楽に切り替えます。',inputSchema:{character:character.optional(),voice:voice.optional(),emotion}},a=>call('emotion',a));
server.registerTool('avatar_speak',{description:'ローカルVOICEVOXで選択したキャラの音声を生成し、開いている表示画面へ表情と口パク付きで送ります。ブラウザで最初に音声を有効にしてください。既定では新しい発話が前の発話を止めます。queue=trueで前の発話の後に順番に話します（掛け合い向け）。wait=trueで再生が終わるまで待ってから返します（最長55秒。表示画面がなければすぐ返ります）。',inputSchema:{character:character.optional(),voice:voice.optional(),text:z.string().min(1).max(2000),emotion:emotion.optional(),style:z.string().optional(),speed:z.number().min(.5).max(2).optional(),queue:z.boolean().optional(),wait:z.boolean().optional()}},a=>call('speak',a));
server.registerTool('avatar_stop',{description:'発話と口パクを停止し、順番待ちも取り消します。',inputSchema:{}},()=>call('stop'));
server.registerTool('avatar_visibility',{description:'表示画面上のキャラクターを表示・非表示にします。',inputSchema:{visible:z.boolean()}},a=>call('visibility',a));
server.registerTool('avatar_export_clip',{description:'解説動画に重ねる、背景透過・音声付きのProRes 4444 MOVを生成します。セリフ・表情・動きを一つの指定でまとめます。WAVとタイミングJSONとZIPも保存します。表示画面やブラウザの音声許可は不要です。最大500字・90秒。',inputSchema:{character:character.optional(),voice:voice.optional(),text:z.string().min(1).max(500),emotion:emotion.optional(),motion:z.enum(['none','nod','bounce','shake']).optional(),style:z.string().optional(),speed:z.number().min(.5).max(2).optional()}},a=>call('export',a));
server.registerTool('avatar_character',{description:`キャラクターを選択します。${characterNames}。voiceで声だけ独立指定できます。立ち絵がないキャラは選べません（avatar_charactersで確認）。`,inputSchema:{character}},a=>call('character',a));
server.registerTool('avatar_voice',{description:'見た目を変えずに声だけを選択します。',inputSchema:{voice}},a=>call('voice',a));
server.registerTool('avatar_shutdown',{description:'表示サーバー（127.0.0.1のローカル画面）を停止します。フォルダを移す前などに使います。次にほかのツールを使うと自動で起動します。',inputSchema:{}},async()=>{if(!await running())return {content:[{type:'text',text:JSON.stringify({ok:true,note:'表示サーバーは動いていません。'})}]};return call('shutdown')});
await server.connect(new StdioServerTransport());
