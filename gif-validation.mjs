// Walk GIF blocks without allocating decoded frame buffers.
export function validGif(bytes){
  if(bytes.length<14||!['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))return false;
  const width=bytes.readUInt16LE(6),height=bytes.readUInt16LE(8);
  if(!width||!height||width>1600||height>1600)return false;
  let pos=13+(bytes[10]&128?3*(1<<((bytes[10]&7)+1)):0),frames=0;
  const blocks=()=>{while(pos<bytes.length){const size=bytes[pos++];if(!size)return true;pos+=size;if(pos>bytes.length)return false;}return false;};
  while(pos<bytes.length){
    const marker=bytes[pos++];
    if(marker===0x3b)return frames>0&&pos===bytes.length;
    if(marker===0x21){if(pos>=bytes.length)return false;pos++;if(!blocks())return false;}
    else if(marker===0x2c){
      if(pos+9>bytes.length)return false;
      const x=bytes.readUInt16LE(pos),y=bytes.readUInt16LE(pos+2),w=bytes.readUInt16LE(pos+4),h=bytes.readUInt16LE(pos+6),packed=bytes[pos+8];
      if(!w||!h||x+w>width||y+h>height||(!(packed&128)&&!(bytes[10]&128))||++frames>300||frames*width*height>60000000)return false;
      pos+=9+(packed&128?3*(1<<((packed&7)+1)):0);
      if(pos>=bytes.length||bytes[pos]<2||bytes[pos]>8)return false;pos++;
      if(pos>=bytes.length||!bytes[pos]||!blocks())return false;
    }else return false;
  }
  return false;
}
