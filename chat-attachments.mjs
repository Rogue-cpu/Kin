import {createHash} from 'node:crypto';
export function decodeAttachment(value,deny){
  deny(!value||typeof value!=='object'||typeof value.data!=='string',400,'Choose a photo or voice recording.');
  const match=/^data:(image\/jpeg|audio\/webm|audio\/ogg|audio\/mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.data);
  deny(!match,400,'Use a JPEG photo or a supported voice recording.');
  deny(match[2].length>4194304,413,'Attachments must be 3 MB or smaller.');
  const bytes=Buffer.from(match[2],'base64'),mime=match[1];
  deny(bytes.length<4||bytes.length>3145728||bytes.toString('base64')!==match[2],400,'Invalid attachment data.');
  const signature=bytes.subarray(0,4).toString('hex');
  const valid=mime==='image/jpeg'?signature.startsWith('ffd8ff'):mime==='audio/webm'?signature==='1a45dfa3':mime==='audio/ogg'?signature==='4f676753':bytes.length>12&&bytes.subarray(4,8).toString()==='ftyp';
  deny(!valid,400,'The attachment does not match its file type.');
  const duration=mime.startsWith('audio/')?value.duration:0;
  deny(!Number.isInteger(duration)||duration<0||duration>60||(mime.startsWith('audio/')&&duration<1),400,'Voice notes can be up to 60 seconds.');
  return {bytes,mime,duration,fingerprint:createHash('sha256').update(mime+':'+duration+':').update(bytes).digest('hex')};
}
