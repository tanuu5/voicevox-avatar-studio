import {AvatarRenderer} from './public/renderer.js';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {accessSync,constants} from 'node:fs';
import {mkdir,writeFile,copyFile,readFile,open} from 'node:fs/promises';
import {crc32} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
// GUI から起動した MCP は PATH が短いことがあるので、Homebrew などのよくある場所も探す。
export function findExecutable(name,override){if(override)return override;for(const dir of [...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin','/usr/bin']){if(!dir)continue;const file=path.join(dir,name);try{accessSync(file,constants.X_OK);return file}catch{}}return null}
export function wavInfo(wav){let pos=12,sampleRate=0,byteRate=0,dataBytes=0;while(pos+8<=wav.length){const name=wav.toString('ascii',pos,pos+4),len=wav.readUInt32LE(pos+4);if(name==='fmt '){sampleRate=wav.readUInt32LE(pos+12);byteRate=wav.readUInt32LE(pos+16)}if(name==='data')dataBytes=len;pos+=8+len+(len%2)}return {sampleRate,duration:byteRate?dataBytes/byteRate:0}}
// 無圧縮（store）の ZIP を書く。MOV は圧縮が効かないので store で足りる。
async function writeZip(file,entries){const out=await open(file,'w'),central=[];let offset=0;try{for(const entry of entries){const data=await readFile(entry),name=Buffer.from(path.basename(entry)),crc=crc32(data)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  await out.write(Buffer.concat([local,name]));await out.write(data);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=30+name.length+data.length}
 const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);await out.write(Buffer.concat([dir,end]))}finally{await out.close()}}
export async function exportClip(s,{emotion='neutral',motion='none',style='ノーマル',speed=1}={}){
 if(!['none','nod','bounce','shake'].includes(motion))throw Error('Unknown motion');
 const characters=JSON.parse(await readFile(path.join(root,'public/characters.json'),'utf8'));const character=characters.find(c=>c.id===s.character);if(!character)throw Error('Unknown character');
 const image=await loadImage(path.join(root,'public',character.sprite)),renderer=new AvatarRenderer(image,character.face,createCanvas);
 const audioPath=path.join(root,'public',s.audio),wav=await readFile(audioPath);
 const {sampleRate,duration}=wavInfo(wav);if(!Number.isFinite(duration)||duration<=0||duration>90)throw Error('Clip duration must be 0–90 seconds');
 const ffmpeg=findExecutable('ffmpeg',process.env.FFMPEG_PATH);if(!ffmpeg)throw Error('FFmpeg が見つかりません。インストールするか、FFMPEG_PATH に実行ファイルの場所を指定してください');
 const dir=path.join(root,'public/clips',s.id);await mkdir(dir,{recursive:true});const movie=path.join(dir,character.id+'.mov'),audio=path.join(dir,'voice.wav'),manifest=path.join(dir,'clip.json'),bundle=path.join(dir,'clip.zip');await copyFile(audioPath,audio);
 const proc=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate','30','-i','pipe:0','-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16','-c:a','pcm_s16le','-t',String(duration),movie],{stdio:['pipe','ignore','pipe']});
 let stderr='';proc.stderr.on('data',b=>stderr+=b);proc.stdin.on('error',()=>{});const completion=once(proc,'close');
 const frame=createCanvas(512,512),fc=frame.getContext('2d'),avatar=createCanvas(512,512),ac=avatar.getContext('2d');
 try{for(let n=0;n<Math.ceil(duration*30);n++){
  const t=n/30;let vowel='sil';for(const f of s.timeline){if(f.time>t)break;vowel=f.vowel}renderer.draw(ac,{emotion,blink:t%3.9>3.74,vowel});
  fc.clearRect(0,0,512,512);fc.save();fc.translate(256,480);
  if(motion==='nod')fc.translate(0,5*Math.sin(t*2*Math.PI/1.5));if(motion==='bounce')fc.translate(0,-10*Math.abs(Math.sin(t*2*Math.PI/1.2)));if(motion==='shake')fc.rotate(.025*Math.sin(t*2*Math.PI/1.3));
  fc.scale(.9,.9);fc.drawImage(avatar,-256,-480);fc.restore();
  if(!proc.stdin.write(await frame.encode('png')))await once(proc.stdin,'drain');
 }proc.stdin.end();const [code]=await completion;if(code!==0)throw Error(stderr.slice(-2000));}catch(e){proc.kill();throw e}
 const details={format:'ProRes 4444 MOV',transparent:true,width:512,height:512,fps:30,duration,sampleRate,text:s.text,emotion,motion,style,speed,lipSync:s.timeline,voice:s.voice,voiceName:s.voiceName,credit:'VOICEVOX:'+(s.voiceName||character.name),character:character.id,characterName:character.name,illustration:'非公式の生成イラスト',files:{movie:character.id+'.mov',audio:'voice.wav'}};
 await writeFile(manifest,JSON.stringify(details,null,2));await writeZip(bundle,[movie,audio,manifest]);
 return {id:s.id,...details,paths:{movie,audio,manifest,bundle},downloads:{movie:`/clips/${s.id}/${character.id}.mov`,audio:`/clips/${s.id}/voice.wav`,bundle:`/clips/${s.id}/clip.zip`}};
}
