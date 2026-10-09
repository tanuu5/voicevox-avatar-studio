// Shared by the browser and transparent-video exporter.
export class AvatarRenderer{
 constructor(image,face,createCanvas){this.image=image;this.face=face;this.layers=[];const sw=image.width/3,sh=image.height/2;
  for(let cell=0;cell<6;cell++){const layer=createCanvas(512,512),lc=layer.getContext('2d');const [dx,dy]=face.offsets?.[cell]||[0,0];lc.drawImage(image,cell%3*sw,Math.floor(cell/3)*sh,sw,sh,dx,dy,512,512);const mask=createCanvas(512,512),mc=mask.getContext('2d');
   for(const x of face.eyes){mc.save();mc.translate(x,face.eyeY);mc.scale(face.rx,face.ry);const g=mc.createRadialGradient(0,0,.88,0,0,1);g.addColorStop(0,'white');g.addColorStop(1,'transparent');mc.fillStyle=g;mc.beginPath();mc.arc(0,0,1,0,Math.PI*2);mc.fill();mc.restore()}
   lc.globalCompositeOperation='destination-in';lc.drawImage(mask,0,0);this.layers.push(layer);
  }
 }
 draw(ctx,{emotion='neutral',blink=false,vowel='sil'}={}){const image=this.image,face=this.face;ctx.clearRect(0,0,512,512);ctx.drawImage(image,0,0,image.width/3,image.height/2,0,0,512,512);const cell=blink?5:{neutral:0,happy:1,angry:2,sad:3,joy:4}[emotion];if(cell)ctx.drawImage(this.layers[cell],0,0);
  const p={a:[14,17],i:[16,6],u:[6,9],e:[13,9],o:[9,15]}[vowel];if(p){const x=face.mouthX,y=face.mouthY;ctx.fillStyle=face.skin;ctx.beginPath();ctx.ellipse(x,y,face.mouthRx||19,face.mouthRy||8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#713d3a';ctx.beginPath();ctx.ellipse(x,y+2,p[0],p[1],0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ee9994';ctx.beginPath();ctx.ellipse(x,y+2+p[1]*.55,p[0]*.65,p[1]*.25,0,0,Math.PI*2);ctx.fill()}
 }
}
