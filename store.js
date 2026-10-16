// Postgres persistence: one JSONB table per collection + bytea table for files. Falls back to JSON file when no DATABASE_URL.
const fs=require('fs'),path=require('path');
const COLLS=['users','strains','posts','comments','swaps','messages','ratings','reports'];
const URL_=process.env.DATABASE_URL;let pool=null;const snap={};let pending=null,running=false,dirty=false;
const mime=n=>({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.pdf':'application/pdf','.heic':'image/heic'})[path.extname(n).toLowerCase()]||'application/octet-stream';
async function init(){if(!URL_)return false;const{Pool}=require('pg');if(pool){await pool.end().catch(()=>{});pool=null}
 pool=new Pool({connectionString:URL_,ssl:/localhost|127\.0\.0\.1/.test(URL_)?false:{rejectUnauthorized:false},max:5,idleTimeoutMillis:30000,connectionTimeoutMillis:20000});
 pool.on('error',e=>console.error('pg pool error',e.code||e.message));
 await pool.query('select 1').catch(async e=>{await pool.end().catch(()=>{});pool=null;throw e});
 for(const c of COLLS)await pool.query(`create table if not exists bs_${c}(id bigint primary key, data jsonb not null)`);
 await pool.query('create table if not exists bs_meta(key text primary key, value jsonb not null)');
 await pool.query('create table if not exists bs_files(name text primary key, mime text not null, data bytea not null, created timestamptz default now())');
 return true}
async function load(){const db={seq:1};for(const c of COLLS){const r=await pool.query(`select id,data from bs_${c} order by id`);db[c]=r.rows.map(x=>x.data);snap[c]=new Map(r.rows.map(x=>[String(x.id),JSON.stringify(x.data)]))}
 const m=await pool.query('select key,value from bs_meta');for(const x of m.rows)db[x.key]=x.value;snap.meta=JSON.stringify({seq:db.seq,secret:db.secret});return db}
async function flush(db){const cl=await pool.connect();try{await cl.query('begin');
 for(const c of COLLS){const prev=snap[c]||new Map(),now=new Map();for(const o of db[c]||[])now.set(String(o.id),JSON.stringify(o));
  for(const[k,v]of now)if(prev.get(k)!==v)await cl.query(`insert into bs_${c}(id,data) values($1,$2) on conflict(id) do update set data=excluded.data`,[k,v]);
  for(const k of prev.keys())if(!now.has(k))await cl.query(`delete from bs_${c} where id=$1`,[k]);snap[c]=now}
 const meta=JSON.stringify({seq:db.seq,secret:db.secret});if(meta!==snap.meta){for(const k of['seq','secret'])if(db[k]!=null)await cl.query('insert into bs_meta(key,value) values($1,$2) on conflict(key) do update set value=excluded.value',[k,JSON.stringify(db[k])]);snap.meta=meta}
 await cl.query('commit')}catch(e){await cl.query('rollback').catch(()=>{});throw e}finally{cl.release()}}
// serialized, coalesced saves
function save(db){if(!pool)return;dirty=true;if(running)return pending;running=true;pending=(async()=>{while(dirty){dirty=false;try{await flush(db)}catch(e){console.error('save failed',e.code||e.message);dirty=true;await new Promise(r=>setTimeout(r,2000))}}running=false})();return pending}
async function putFile(name,buf){await pool.query('insert into bs_files(name,mime,data) values($1,$2,$3) on conflict(name) do update set data=excluded.data,mime=excluded.mime',[name,mime(name),buf])}
const cache=new Map();let cacheBytes=0;
async function getFile(name){if(cache.has(name))return cache.get(name);const r=await pool.query('select mime,data from bs_files where name=$1',[name]);if(!r.rows[0])return null;const f={mime:r.rows[0].mime,data:r.rows[0].data};
 if(f.data.length<3e6){cache.set(name,f);cacheBytes+=f.data.length;while(cacheBytes>60e6){const[k,v]=cache.entries().next().value;cache.delete(k);cacheBytes-=v.data.length}}return f}
async function importDir(dir,prefix=''){if(!fs.existsSync(dir))return 0;let n=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())n+=await importDir(p,prefix+e.name+'/');else if(e.name!='.gitkeep'){await putFile(prefix+e.name,fs.readFileSync(p));n++}}return n}
module.exports={init,load,save,putFile,getFile,importDir,COLLS,get pg(){return!!pool},flushNow:db=>flush(db)};
