import { PGlite } from '@electric-sql/pglite';
export async function testDatabase() {
  const database = new PGlite();
  await database.waitReady;
  let tail = Promise.resolve();
  const acquire = async () => {let release;const next=new Promise(resolve=>{release=resolve;});const previous=tail;tail=next;await previous;return release;};
  const run = (sql, values) => sql.trim().startsWith('BEGIN;') ? database.exec(sql) : database.query(sql, values);
  return {
    async query(sql,values){const release=await acquire();try{return await run(sql,values);}finally{release();}},
    async connect(){const release=await acquire();return {query:run,release};},
    async end(){await tail;await database.close();}
  };
}
