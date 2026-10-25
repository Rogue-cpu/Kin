// Original Kin reaction artwork. Indexed GIF frames are encoded without a runtime dependency.
export const GIFS=[
  {id:'hello',title:'Hello!',text:['HELLO!'],tags:['hello','hi','wave','welcome','greeting'],art:'wave',color:4},
  {id:'laugh',title:'LOL',text:['LOL'],tags:['laugh','lol','funny','haha','reaction'],art:'smile',color:3},
  {id:'love',title:'Love this',text:['LOVE THIS'],tags:['love','heart','cute','romance'],art:'heart',color:2},
  {id:'wow',title:'Wow!',text:['WOW!'],tags:['wow','surprised','shock','reaction'],art:'star',color:3},
  {id:'yes',title:'Yes!',text:['YES!'],tags:['yes','agree','okay','ready','reaction'],art:'check',color:4},
  {id:'nope',title:'Nope',text:['NOPE'],tags:['no','nope','disagree','reaction'],art:'cross',color:2},
  {id:'hugs',title:'Sending hugs',text:['SENDING','HUGS'],tags:['hug','hugs','comfort','love','friend'],art:'heart',color:5},
  {id:'thanks',title:'Thank you',text:['THANK','YOU'],tags:['thank','thanks','thank you','grateful'],art:'star',color:4},
  {id:'applause',title:'Take a bow',text:['TAKE A','BOW'],tags:['applause','clap','celebrate','celebration','bravo'],art:'star',color:3},
  {id:'your-turn',title:'Your turn',text:['YOUR TURN'],tags:['roleplay','rp','reply','your turn','scene'],art:'arrow',color:5},
  {id:'plot-twist',title:'Plot twist',text:['PLOT','TWIST'],tags:['roleplay','rp','plot','plot twist','drama','shock'],art:'star',color:2},
  {id:'ooc',title:'OOC moment',text:['OOC','MOMENT'],tags:['roleplay','rp','ooc','writer','planning'],art:'smile',color:5},
  {id:'brb',title:'Be right back',text:['BRB'],tags:['roleplay','brb','be right back','away','later'],art:'wave',color:4},
  {id:'lets-go',title:"Let's go!",text:['LETS GO!'],tags:['celebrate','celebration','excited','ready','lets go'],art:'star',color:3},
  {id:'goodnight',title:'Good night',text:['GOOD','NIGHT'],tags:['goodnight','good night','sleep','bye','moon'],art:'moon',color:5},
  {id:'miss-you',title:'Miss you',text:['MISS YOU'],tags:['miss','miss you','love','friend','thinking of you'],art:'heart',color:2}
];
const FONT={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],W:['10001','10001','10001','10101','10101','11011','10001'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],'!':['00100','00100','00100','00100','00100','00000','00100'],' ':['00000','00000','00000','00000','00000','00000','00000']};
FONT.V=['10001','10001','10001','10001','10001','01010','00100'];
const width=160,height=128,cache=new Map();
const palette=Buffer.from([17,13,25,40,29,57,248,104,158,255,206,102,103,218,190,176,151,250,245,238,255,91,62,128]);
function drawFrame(gif,frame){
  const pixels=Buffer.alloc(width*height);const phase=frame/12*Math.PI*2,bounce=Math.round(Math.sin(phase)*3);
  const rect=(x,y,w,h,color)=>{for(let yy=Math.max(0,y);yy<Math.min(height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(width,x+w);xx++)pixels[yy*width+xx]=color;};
  const circle=(cx,cy,r,color)=>{for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++)if(x*x+y*y<=r*r)rect(cx+x,cy+y,1,1,color);};
  const line=(x1,y1,x2,y2,color,size=2)=>{const steps=Math.max(Math.abs(x2-x1),Math.abs(y2-y1));for(let i=0;i<=steps;i++)rect(Math.round(x1+(x2-x1)*i/steps),Math.round(y1+(y2-y1)*i/steps),size,size,color);};
  rect(5,5,150,118,1);rect(5,5,150,2,7);rect(5,121,150,2,7);
  for(let i=0;i<7;i++){const x=14+((i*23+frame*2)%130),y=12+((i*31)%92);rect(x,y,2,2,i%2?7:gif.color);}
  const cy=38+bounce,c=gif.color;
  if(gif.art==='heart'){
    for(let y=-18;y<=18;y++)for(let x=-23;x<=23;x++){const xx=x/22,yy=-y/19;if(Math.pow(xx*xx+yy*yy-1,3)-xx*xx*yy*yy*yy<=0)rect(80+x,cy+y,1,1,c);}
    rect(68,cy-10,4,4,6);
  }else if(gif.art==='star'){
    for(let y=-22;y<=22;y++)for(let x=-25;x<=25;x++){const a=Math.atan2(y,x),r=15+7*Math.cos(5*(a-Math.PI/2)+Math.sin(phase)*.2);if(x*x+y*y<=r*r)rect(80+x,cy+y,1,1,c);}
  }else if(gif.art==='smile'){
    circle(80,cy,22,c);rect(70,cy-5,3,4,0);rect(88,cy-5,3,4,0);line(70,cy+6,76,cy+12,0);line(76,cy+12,84,cy+12,0);line(84,cy+12,90,cy+6,0);
  }else if(gif.art==='check'){circle(80,cy,22,c);line(67,cy,76,cy+10,0,4);line(76,cy+10,93,cy-10,0,4);}
  else if(gif.art==='cross'){circle(80,cy,22,c);line(69,cy-11,89,cy+9,0,4);line(69,cy+9,89,cy-11,0,4);}
  else if(gif.art==='arrow'){line(57,cy,99,cy,c,5);line(86,cy-14,100,cy,c,5);line(86,cy+14,100,cy,c,5);}
  else if(gif.art==='moon'){circle(80,cy,22,c);circle(91,cy-8,20,1);rect(58,cy-21,3,3,6);}
  else {circle(80,cy,20,c);for(let i=0;i<4;i++)rect(65+i*9,cy-25-(i%2?3:0),5,18,c);line(99,cy-16,107+Math.round(Math.sin(phase)*4),cy-22,6,2);}
  const text=(value,y,scale)=>{let x=Math.round((width-(value.length*6-1)*scale)/2);for(const char of value){(FONT[char]||FONT[' ']).forEach((row,yy)=>{[...row].forEach((bit,xx)=>{if(bit==='1')rect(x+xx*scale,y+yy*scale,scale,scale,6);});});x+=6*scale;}};
  gif.text.forEach((value,i)=>text(value,(gif.text.length===1?84:73)+i*18+bounce,2));
  return pixels;
}
export function gifBytes(id){
  if(cache.has(id))return cache.get(id);
  const gif=GIFS.find(g=>g.id===id);if(!gif)return null;
  const parts=[Buffer.from('GIF89a'),Buffer.from([160,0,128,0,0xf2,0,0]),palette,Buffer.from([0x21,0xff,0x0b]),Buffer.from('NETSCAPE2.0'),Buffer.from([3,1,0,0,0])];
  for(let frame=0;frame<12;frame++){
    parts.push(Buffer.from([0x21,0xf9,4,4,9,0,0,0,0x2c,0,0,0,0,160,0,128,0,0,3]));
    // Encode short constant-color runs, clearing before the code width grows.
    const pixels=drawFrame(gif,frame),codes=[];
    for(let i=0;i<pixels.length;){const color=pixels[i];let count=1;while(i+count<pixels.length&&pixels[i+count]===color)count++;i+=count;
      while(count){let length=1;while(length<6&&(length+1)*(length+2)/2<=count)length++;codes.push(8,color);for(let n=2;n<=length;n++)codes.push(8+n);count-=length*(length+1)/2;}
    }
    codes.push(9);const data=Buffer.alloc(Math.ceil(codes.length/2));for(let i=0;i<codes.length;i++)data[i>>1]|=codes[i]<<((i&1)*4);
    for(let i=0;i<data.length;i+=255){const block=data.subarray(i,i+255);parts.push(Buffer.from([block.length]),block);}parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b]));const bytes=Buffer.concat(parts);cache.set(id,bytes);return bytes;
}
export function gifCatalog(query=''){
  const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return GIFS.filter(g=>words.every(word=>(g.title+' '+g.tags.join(' ')).toLowerCase().includes(word))).map(g=>({id:g.id,title:g.title,url:'/api/gifs/'+g.id}));
}
