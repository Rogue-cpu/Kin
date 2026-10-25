import {randomUUID} from 'node:crypto';

export async function recordNotification(client,{recipient,actor,kind,type,key,postId=null,replyId=null,connectionId=null}){
  if(recipient===actor)return;
  await client.query(`INSERT INTO kin_notifications(id,event_key,recipient,actor,profile_kind,event_type,post_id,reply_id,connection_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(event_key) DO NOTHING`,[randomUUID(),key,recipient,actor,kind,type,postId,replyId,connectionId]);
}

export function notificationRoutes({transaction,limited,deny,id,canRead}){
  const actorRead=canRead.replaceAll('$1','n.actor');
  const visible=`n.recipient=$1 AND n.profile_kind=$2 AND (
    (n.event_type IN ('like','comment','comment_reply') AND p.profile_kind=$2 AND ${canRead} AND ${actorRead}
      AND ((n.event_type='like' AND EXISTS(SELECT 1 FROM kin_likes l WHERE l.user_id=n.actor AND l.post_id=p.id))
        OR (n.event_type IN ('comment','comment_reply') AND r.post_id=p.id AND r.author=n.actor)))
    OR (n.event_type='request' AND c.profile_kind=$2 AND c.status='pending' AND c.recipient=$1 AND c.requester=n.actor)
    OR (n.event_type='accepted' AND c.profile_kind=$2 AND c.status='accepted' AND c.requester=$1 AND c.recipient=n.actor)
  )`;
  const joins=`FROM kin_notifications n JOIN kin_users u ON u.id=n.actor LEFT JOIN kin_posts p ON p.id=n.post_id LEFT JOIN kin_replies r ON r.id=n.reply_id LEFT JOIN kin_connections c ON c.id=n.connection_id`;
  const unread=async(client,user,kind)=>Number((await client.query(`SELECT count(*)::integer AS count ${joins} WHERE ${visible} AND n.read_at IS NULL`,[user,kind])).rows[0].count);
  return async({req,route,url,body,user,kind,send})=>{
    if(!['/api/notifications','/api/notifications/unread','/api/notifications/read'].includes(route))return false;
    if(req.method==='GET'&&route==='/api/notifications/unread'){
      send(200,{unreadCount:await transaction(client=>unread(client,user.id,kind))});return true;
    }
    if(req.method==='GET'&&route==='/api/notifications'){
      const before=url.searchParams.get('before');deny(before!==null&&!/^[1-9][0-9]{0,17}$/.test(before),400,'Invalid activity cursor.');
      const onlyUnread=url.searchParams.get('unread')==='true';
      const result=await transaction(async client=>{
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const rows=(await client.query(`SELECT n.id,n.seq::text,n.event_type AS type,n.created_at,n.read_at,n.post_id,n.reply_id,left(r.body,180) AS excerpt,p.image_id,
          u.id AS actor_id,u.handle,CASE WHEN $2='personal' THEN u.personal ELSE u.character END AS profile,
          EXISTS(SELECT 1 FROM kin_connections relation WHERE relation.status='accepted' AND relation.profile_kind=$2 AND ((relation.requester=$1 AND relation.recipient=n.actor) OR (relation.recipient=$1 AND relation.requester=n.actor))) AS connected
          ${joins} WHERE ${visible} AND ($3::bigint IS NULL OR n.seq<$3::bigint) AND (NOT $4::boolean OR n.read_at IS NULL) ORDER BY n.seq DESC LIMIT 51`,[user.id,kind,before,onlyUnread])).rows;
        const notifications=rows.slice(0,50).map(row=>({id:row.id,seq:row.seq,type:row.type,createdAt:row.created_at,read:!!row.read_at,postId:row.post_id,replyId:row.reply_id,excerpt:row.excerpt||'',thumbnail:row.image_id?'/api/media/'+row.image_id:'',actor:{id:row.actor_id,handle:row.connected||row.type==='request'?row.handle:'',name:row.profile.name,portrait:row.connected?row.profile.portrait||'':''},connected:row.connected}));
        return {notifications,hasMore:rows.length>50,unreadCount:await unread(client,user.id,kind)};
      });send(200,result);return true;
    }
    if(req.method==='POST'&&route==='/api/notifications/read'){
      await limited(`activity-read:${user.id}`,120,60);
      const all=body.all===true;let ids=[],through=null;
      if(all){deny(typeof body.through!=='string'||!/^[1-9][0-9]{0,17}$/.test(body.through),400,'Refresh activity before marking it read.');through=body.through;}
      else{deny(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>100,400,'Choose up to 100 notifications.');ids=body.ids.map(id);}
      const count=await transaction(async client=>{
        await client.query(`UPDATE kin_notifications SET read_at=COALESCE(read_at,now()) WHERE id IN(SELECT n.id ${joins} WHERE ${visible} AND (($3::bigint IS NOT NULL AND n.seq<=$3::bigint) OR n.id=ANY($4::uuid[])))`,[user.id,kind,through,ids]);
        return unread(client,user.id,kind);
      });send(200,{unreadCount:count});return true;
    }
    deny(true,405,'Method not supported.');
  };
}
