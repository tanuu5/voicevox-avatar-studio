import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {readFile,access} from 'node:fs/promises';
import {AvatarRenderer} from './public/renderer.js';
const characters=JSON.parse(await readFile(new URL('./public/characters.json',import.meta.url)));
for(const character of characters){try{await access(new URL('./public'+character.sprite,import.meta.url))}catch{console.log('SKIP',character.id,'(立ち絵なし)');continue}const image=await loadImage(new URL('./public'+character.sprite,import.meta.url).pathname),c=createCanvas(512,512),ctx=c.getContext('2d'),r=new AvatarRenderer(image,character.face,createCanvas);r.draw(ctx);const normal=ctx.getImageData(0,0,512,512).data;
for(const emotion of ['happy','angry','sad','joy','neutral']){r.draw(ctx,{emotion,blink:emotion==='neutral'});const frame=ctx.getImageData(0,0,512,512).data;let outside=0,inside=0;for(let y=0;y<512;y++)for(let x=0;x<512;x++){const f=character.face;const allowed=f.eyes.some(ex=>Math.abs(x-ex)<=f.rx+1&&Math.abs(y-f.eyeY)<=f.ry+1);for(let k=0;k<4;k++){const i=(y*512+x)*4+k;if(frame[i]!==normal[i]){if(allowed)inside++;else outside++}}}assert.equal(outside,0,character.id+' body changed during '+emotion);assert.ok(inside>0,character.id+' eyes did not change during '+emotion)}
assert.ok(normal.some((v,i)=>i%4===3&&v===0),character.id+' missing transparency');console.log('PASS',character.id,'all expression/blink changes confined to eyes; transparent background');}
