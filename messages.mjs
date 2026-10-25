import { randomUUID } from 'node:crypto';

// Every member must still be approved by every other member in this profile.
const CONNECTED = `NOT EXISTS (SELECT 1 FROM kin_chat_members a JOIN kin_chat_members b ON a.chat_id=b.chat_id AND a.user_id<b.user_id WHERE a.chat_id=c.id AND NOT EXISTS (SELECT 1 FROM kin_connections r WHERE r.profile_kind=c.profile_kind AND r.status='accepted' AND ((r.requester=a.user_id AND r.recipient=b.user_id) OR (r.recipient=a.user_id AND r.requester=b.user_id))))`;
const ACCESS = `c.profile_kind=$2 AND EXISTS(SELECT 1 FROM kin_chat_members m WHERE m.chat_id=c.id AND m.user_id=$1) AND ${CONNECTED}`;

export function chatRoutes({ transaction, limited, deny, text, id }) {
  async function authorize(client,user,kind,chat) {
    const row=(await client.query(`SELECT c.* FROM kin_chats c WHERE c.id=$3 AND ${ACCESS} FOR UPDATE`,[user,kind,chat])).rows[0];
    deny(!row,404,'This conversation is unavailable. All members must remain approved connections.');
    return row;
  }
  async function participants(client,chat,kind,user) {
    return (await client.query(`SELECT u.id,u.handle,CASE WHEN $2='personal' THEN u.personal ELSE u.character END AS profile FROM kin_chat_members m JOIN kin_users u ON u.id=m.user_id WHERE m.chat_id=$1 ORDER BY u.handle`,[chat,kind])).rows.map(r=>({id:r.id,self:r.id===user,handle:r.handle,name:r.profile.name,portrait:r.profile.portrait||''}));
  }
  return async ({req,route,url,body,user,kind,send})=>{
    if(route!=='/api/chats'&&!/^\/api\/chats\/[a-f0-9-]{36}\/messages$/.test(route))return false;
    if(req.method==='GET'&&route==='/api/chats') {
      const chats=await transaction(async client=>{
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const rows=(await client.query(`SELECT c.id,c.title,c.is_group,c.created_at,(SELECT body FROM kin_messages WHERE chat_id=c.id ORDER BY seq DESC LIMIT 1) AS preview,(SELECT created_at FROM kin_messages WHERE chat_id=c.id ORDER BY seq DESC LIMIT 1) AS updated_at FROM kin_chats c WHERE ${ACCESS} ORDER BY COALESCE((SELECT max(seq) FROM kin_messages WHERE chat_id=c.id),0) DESC,c.created_at DESC LIMIT 100`,[user.id,kind])).rows;
        for(const c of rows)c.members=await participants(client,c.id,kind,user.id);
        return rows;
      });send(200,{chats});return true;
    }
    if(req.method==='POST'&&route==='/api/chats') {
      await limited(`chat-create:${user.id}`,20,3600);
      deny(!Array.isArray(body.members)||body.members.length<1||body.members.length>9,400,'Choose between 1 and 9 approved connections.');
      const members=[user.id,...body.members.map(id)];
      deny(new Set(members).size!==members.length,400,'Choose each connection once.');
      const title=text(body.title||'',80), group=members.length>2;
      const chat=await transaction(async client=>{
        // Lock users in a stable order to avoid duplicate direct chats under concurrency.
        await client.query('SELECT id FROM kin_users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[members]);
        for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++) {
          const approved=(await client.query(`SELECT id FROM kin_connections WHERE profile_kind=$3 AND status='accepted' AND ((requester=$1 AND recipient=$2) OR (recipient=$1 AND requester=$2)) FOR SHARE`,[members[i],members[j],kind])).rows.length;
          deny(!approved,403,'Everyone in a chat must be approved connections with one another in this profile.');
        }
        if(!group){const existing=(await client.query(`SELECT c.id FROM kin_chats c WHERE c.profile_kind=$3 AND NOT c.is_group AND EXISTS(SELECT 1 FROM kin_chat_members WHERE chat_id=c.id AND user_id=$1) AND EXISTS(SELECT 1 FROM kin_chat_members WHERE chat_id=c.id AND user_id=$2)`,[members[0],members[1],kind])).rows[0];if(existing)return existing.id;}
        const chatId=randomUUID();
        await client.query('INSERT INTO kin_chats(id,profile_kind,creator,title,is_group) VALUES($1,$2,$3,$4,$5)',[chatId,kind,user.id,group?title:'',group]);
        for(const member of members)await client.query('INSERT INTO kin_chat_members(chat_id,user_id) VALUES($1,$2)',[chatId,member]);
        return chatId;
      });send(201,{id:chat});return true;
    }
    const chat=id(route.split('/')[3]);
    if(req.method==='GET') {
      const raw=url.searchParams.get('before');deny(raw!==null&&!/^[1-9][0-9]{0,17}$/.test(raw),400,'Invalid message cursor.');
      const result=await transaction(async client=>{
        const conversation=await authorize(client,user.id,kind,chat);
        const rows=(await client.query('SELECT seq::text,id,sender,body,created_at FROM kin_messages m WHERE chat_id=$1 AND ($2::bigint IS NULL OR m.seq<$2::bigint) ORDER BY m.seq DESC LIMIT 101',[chat,raw])).rows;
        const more=rows.length>100;const messages=rows.slice(0,100).reverse().map(r=>({...r,self:r.sender===user.id}));
        return {id:chat,title:conversation.title,isGroup:conversation.is_group,members:await participants(client,chat,kind,user.id),messages,hasMore:more};
      });send(200,result);return true;
    }
    if(req.method==='POST') {
      await limited(`chat-send:${user.id}`,60,60);
      const content=text(body.text,4000,true), messageId=id(body.id);
      await transaction(async client=>{
        await authorize(client,user.id,kind,chat);
        const previous=(await client.query('SELECT sender,chat_id,body FROM kin_messages WHERE id=$1',[messageId])).rows[0];
        if(previous){deny(previous.sender!==user.id||previous.chat_id!==chat||previous.body!==content,409,'That message identifier is already used.');return;}
        await client.query('INSERT INTO kin_messages(id,chat_id,sender,body) VALUES($1,$2,$3,$4)',[messageId,chat,user.id,content]);
      });send(201,{ok:true});return true;
    }
    deny(true,405,'Method not supported.');
  };
}
