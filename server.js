const express=require('express'),multer=require('multer'),bcrypt=require('bcryptjs'),session=require('cookie-session'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const DBF=path.join(__dirname,'data/db.json');
const store=require('./store');let db={users:[],strains:[],swaps:[],messages:[],ratings:[],reports:[],posts:[],comments:[],seq:1};
const save=()=>store.pg?store.save(db):fs.writeFileSync(DBF,JSON.stringify(db));const id=()=>db.seq++;
const DISCLAIMER="Swap at your own risk. Cannabis laws differ by country and region — only swap where it is legal for you. Bud Share does not allow sales.";const REPORT_LIMIT=3,TYPES=['Indica','Sativa','Indica-leaning hybrid','Sativa-leaning hybrid','50/50'],METHODS=['Indoor','Outdoor','Greenhouse'];
const app=express();app.set('trust proxy',1);app.use((q,r,n)=>{const h=(q.hostname||'').toLowerCase();if(h!=='app.budshare.co.za'&&/(^|\.)budshare\.(co\.za|net|org)$/.test(h))return r.redirect(301,'https://app.budshare.co.za'+q.originalUrl);n()});app.use(express.json());
app.use(session({name:'bs',keys:[process.env.SECRET||'budshare-dev-secret'],maxAge:30*864e5,sameSite:'lax'}));
app.use((q,r,n)=>{r.set('X-Robots-Tag','noindex, nofollow, noarchive');n()});
app.get('/healthz',(q,r)=>r.send('ok'));
app.get('/robots.txt',(q,r)=>r.type('text/plain').send('User-agent: *\nDisallow: /\n'));
const SU=process.env.SITE_USER,SP=process.env.SITE_PASS,GATE=SU&&SP?crypto.createHmac('sha256',SP).update('gate:'+SU).digest('hex'):null;
const OPEN=/^\/(healthz|manifest\.json|icon-(maskable-)?(192|512)\.png|apple-touch-icon\.png|favicon\.ico|og-image\.png|whoomph-(logo|badge)(-[0-9a-f]+)?\.png|robots\.txt|sw\.js)$/;
const eq=(a,b)=>{a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length==b.length&&crypto.timingSafeEqual(a,b)};
app.get('/join',(q,r,n)=>{const c=String(q.query.ref||'').toUpperCase().slice(0,20);const u=c&&db.users.find(x=>x.code==c&&!x.banned&&!x.deleted);
 if(!u)return n();if(GATE)r.cookie('bsgate',GATE,{httpOnly:true,secure:q.secure,sameSite:'lax',maxAge:365*864e5});r.redirect(302,'/?ref='+encodeURIComponent(c)+'#/signup')});
const gatePage=bad=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Bud Share</title><style>body{margin:0;background:#000;color:#eee;font:16px -apple-system,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}form{width:86%;max-width:340px;text-align:center}img{width:72px;border-radius:16px}input,button{width:100%;box-sizing:border-box;padding:13px;margin:6px 0;border-radius:10px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:16px}button{background:#25D366;color:#000;font-weight:700;border:0}.e{color:#ff6b6b}</style></head><body><form method="post" action="/gate"><img src="/icon-192.png" alt=""><h2>Bud Share</h2><p>Private test environment – enter your access details.</p>${bad?'<p class="e">Incorrect, try again.</p>':''}<input name="u" placeholder="Username" autocomplete="username" autocapitalize="none" required><input name="p" type="password" placeholder="Password" autocomplete="current-password" required><button>Enter</button></form></body></html>`;
app.post('/gate',express.urlencoded({extended:false}),(q,r)=>{const{u,p}=q.body||{};if(GATE&&eq(u||'',SU)&&eq(p||'',SP)){r.cookie('bsgate',GATE,{httpOnly:true,secure:q.secure,sameSite:'lax',maxAge:365*864e5});return r.redirect(303,'/')}r.redirect(303,'/?bad=1')});
app.use((q,r,n)=>{if(!GATE||OPEN.test(q.path))return n();const c=(q.headers.cookie||'').match(/(?:^|;\s*)bsgate=([a-f0-9]+)/);if(c&&eq(c[1],GATE))return n();
 const h=q.headers.authorization||'';if(h.startsWith('Basic ')){const[u,...pw]=Buffer.from(h.slice(6),'base64').toString().split(':');if(eq(u,SU)&&eq(pw.join(':'),SP)){r.cookie('bsgate',GATE,{httpOnly:true,secure:q.secure,sameSite:'lax',maxAge:365*864e5});return n()}}
 const nav=q.method=='GET'&&!q.path.startsWith('/api')&&/text\/html/.test(q.headers.accept||'');
 if(nav)return r.status(401).type('html').send(gatePage(q.query.bad));
 r.set('WWW-Authenticate','Basic realm="Bud Share private test", charset="UTF-8"').status(401).type('text/plain').send('Bud Share is a private test environment. Access code required.')});
app.use(express.static(path.join(__dirname,'public'),{setHeaders:(r,f)=>{const b=path.basename(f);if(b=='index.html'||b=='sw.js'||b=='manifest.json')r.setHeader('Cache-Control','no-cache, no-store, must-revalidate');else if(/-[0-9a-f]{8}\.png$/.test(b))r.setHeader('Cache-Control','public, max-age=31536000, immutable')}}));app.get('/uploads/*name',async(q,r,n)=>{if(!store.pg)return n();try{const nm=[].concat(q.params.name).join('/');const f=await store.getFile(nm);if(!f)return r.status(404).end();r.set('Content-Type',f.mime).set('Cache-Control','private, max-age=31536000, immutable').send(f.data)}catch(e){r.status(500).end()}});
app.use('/uploads',express.static(path.join(__dirname,'uploads')));
const up=multer({storage:multer.diskStorage({destination:'uploads',filename:(r,f,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(4).toString('hex')+path.extname(f.originalname).toLowerCase())}),limits:{fileSize:15e6},fileFilter:(r,f,cb)=>cb(null,/^image\/|application\/pdf/.test(f.mimetype))});
const toDb=async(q,r,n)=>{if(!store.pg)return n();try{const fl=[...(q.file?[q.file]:[]),...(Array.isArray(q.files)?q.files:Object.values(q.files||{}).flat())];
 for(const f of fl){await store.putFile(f.filename,fs.readFileSync(f.path));fs.unlink(f.path,()=>{})}n()}catch(e){console.error('file save',e.code||e.message);r.status(500).json({error:'Could not save photo, try again'})}};
const U=i=>db.users.find(u=>u.id==i&&!u.deleted),S=i=>db.strains.find(s=>s.id==i);
const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length*10)/10:null;
const code=u=>u.code||(u.code=crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,6));
const pubU=u=>u&&({invitedBy:u.invitedBy&&db.users.find(x=>x.id==u.invitedBy)?{id:u.invitedBy,name:db.users.find(x=>x.id==u.invitedBy).name}:null,invitedCount:db.users.filter(x=>x.invitedBy==u.id).length,id:u.id,name:u.name,town:u.town,province:u.province,country:u.country||'South Africa',photo:u.photo,rating:avg(db.ratings.filter(r=>r.rateeId==u.id).map(r=>r.memberStars)),ratingCount:db.ratings.filter(r=>r.rateeId==u.id).length,reports:u.reports||0,joined:u.joined,lastSeen:u.lastSeen||null,followerCount:(db.follows||[]).filter(f=>f.followingId==u.id).length,followingCount:(db.follows||[]).filter(f=>f.followerId==u.id).length});
const pubUv=(u,vid)=>u&&({...pubU(u),isSelf:u.id==vid,iFollow:(db.follows||[]).some(f=>f.followerId==vid&&f.followingId==u.id),followsMe:(db.follows||[]).some(f=>f.followerId==u.id&&f.followingId==vid)});
const pubS=s=>({...s,held:!!s.modHeld,flowerRating:avg(db.ratings.filter(r=>r.strainId==s.id).map(r=>r.flowerStars)),flowerRatingCount:db.ratings.filter(r=>r.strainId==s.id).length,labTested:!!s.coa,owner:pubU(U(s.userId))});
const NEAR=['Same town','Same area','Same country','Other country'],cty=u=>u.country||'South Africa';
const near=(o,m)=>cty(o)!=cty(m)?3:o.province!=m.province?2:(o.town||'').toLowerCase()==(m.town||'').toLowerCase()?0:1;
const hasActive=uid=>db.strains.some(s=>s.userId==uid&&s.active);
const auth=(q,r,n)=>{const u=U(q.session.uid);if(!u)return r.status(401).json({error:'Please log in'});if(u.banned)return r.status(403).json({error:'Account removed after repeated non-delivery reports'});q.u=u;if(!u.lastSeen||Date.now()-u.lastSeen>60000){u.lastSeen=Date.now();save()}n()};
const grower=(q,r,n)=>q.u.admin||hasActive(q.u.id)?n():r.status(403).json({error:'grower_only',message:'List at least one active strain to browse and swap.'});
const age=d=>{const b=new Date(d),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a};
app.post('/api/signup',(q,r)=>{const{email,password,name,dob,town,province,agree,agreeRisk}=q.body||{};const country=String(q.body.country||'South Africa').slice(0,80);
 if(!email||!password||!name||!dob||!town||!province)return r.status(400).json({error:'All fields are required'});
 if(!agree)return r.status(400).json({error:'You must accept the terms'});
 if(!agreeRisk)return r.status(400).json({error:'Please tick that you understand the swap-at-your-own-risk notice'});
 if(isNaN(new Date(dob))||age(dob)<18)return r.status(400).json({error:'You must be 18 or older to join'});
 if(password.length<6)return r.status(400).json({error:'Password must be at least 6 characters'});
 const e=email.trim().toLowerCase();const ex=db.users.find(u=>u.email==e);if(ex)return r.status(400).json({error:ex.banned?'This email was removed from Bud Share':'Email already registered'});
 const inv=q.body.ref&&db.users.find(x=>x.code&&x.code==String(q.body.ref).toUpperCase()&&!x.banned);
 const u={id:id(),email:e,invitedBy:inv?inv.id:null,pw:bcrypt.hashSync(password,8),name:name.trim(),dob,town:town.trim(),province:String(province).trim().slice(0,80),country,agreedRiskAt:Date.now(),photo:null,reports:0,joined:Date.now()};db.users.push(u);save();q.session.uid=u.id;r.json({ok:1})});
app.post('/api/login',(q,r)=>{const u=db.users.find(u=>u.email==(q.body.email||'').trim().toLowerCase());if(!u||!bcrypt.compareSync(q.body.password||'',u.pw))return r.status(400).json({error:'Wrong email or password'});if(u.banned)return r.status(403).json({error:'Account removed after repeated non-delivery reports'});q.session.uid=u.id;r.json({ok:1})});
app.post('/api/logout',(q,r)=>{q.session=null;r.json({ok:1})});
app.get('/api/invite/:code',(q,r)=>{const u=db.users.find(x=>x.code==String(q.params.code).toUpperCase()&&!x.banned);r.json(u?{name:u.name}:{})});
app.get('/api/me',auth,(q,r)=>r.json({...pubU(q.u),inviteCode:code(q.u),email:q.u.email,isGrower:hasActive(q.u.id),admin:!!q.u.admin,reasons:REASONS,reportLimit:REPORT_LIMIT,needsDob:!u18ok(q.u)}));
app.post('/api/me',auth,up.single('photo'),toDb,(q,r)=>{const b=q.body;if(b.name&&b.name.trim()!=q.u.name){const sc=scanText(b.name);if(sc.action=='hold'){modLog('profile',q.u.id,q.u.id,b.name,sc);save();return r.status(400).json({error:'That name was held for review by our moderation checks. Please choose another name.'})}if(sc.action=='flag')modLog('profile',q.u.id,q.u.id,b.name,sc)}if(q.file)photoFlag('profile',q.u.id,q.u.id,['/uploads/'+q.file.filename]);['name','town','province','country'].forEach(k=>b[k]&&(q.u[k]=b[k].trim().slice(0,80)));if(q.file)q.u.photo='/uploads/'+q.file.filename;if(b.removePhoto)q.u.photo=null;save();r.json({ok:1})});
app.get('/api/users/:id',auth,(q,r)=>{const u=U(q.params.id);if(!u||u.banned)return r.status(404).json({error:'Not found'});r.json({user:pubUv(u,q.u.id),strains:db.strains.filter(s=>s.userId==u.id&&s.active&&!(s.modHeld&&q.u.id!=u.id&&!q.u.admin)).map(pubS)})});
app.post('/api/users/:id/follow',auth,(q,r)=>{const o=U(q.params.id);if(!o||o.banned)return r.status(404).json({error:'Not found'});if(o.id==q.u.id)return r.status(400).json({error:"You can't follow yourself"});db.modflags=db.modflags||[];db.follows=db.follows||[];
 const i=db.follows.findIndex(f=>f.followerId==q.u.id&&f.followingId==o.id);let following;
 if(i>=0){db.follows.splice(i,1);following=false}else{db.follows.push({id:id(),followerId:q.u.id,followingId:o.id,at:Date.now()});following=true;try{notify(o.id,'follow',{title:q.u.name,body:q.u.name+' started following you 🌱',url:'#/user/'+q.u.id,tag:'follow-'+q.u.id})}catch(e){}}
 save();r.json({ok:1,following,followerCount:db.follows.filter(f=>f.followingId==o.id).length})});
app.get('/api/following',auth,(q,r)=>{db.follows=db.follows||[];const list=db.follows.filter(f=>f.followerId==q.u.id).sort((a,b)=>b.at-a.at).map(f=>{const o=U(f.followingId);if(!o)return null;const st=db.strains.filter(s=>s.userId==o.id&&s.active).sort((a,b)=>b.created-a.created);
 return{user:pubUv(o,q.u.id),followedAt:f.at,activeStrainCount:st.length,latestStrain:st[0]?{id:st[0].id,name:st[0].name,created:st[0].created}:null,hasChat:db.swaps.some(w=>(w.aId==q.u.id&&w.bId==o.id)||(w.bId==q.u.id&&w.aId==o.id))}}).filter(Boolean);r.json(list)});
app.get('/api/followers',auth,(q,r)=>{db.follows=db.follows||[];r.json(db.follows.filter(f=>f.followingId==q.u.id).sort((a,b)=>b.at-a.at).map(f=>({user:pubUv(U(f.followerId),q.u.id),followedAt:f.at})).filter(x=>x.user))});
app.get('/api/meta',(q,r)=>r.json({types:TYPES,methods:METHODS,reportLimit:REPORT_LIMIT,disclaimer:DISCLAIMER}));
const sf=up.fields([{name:'flower'},{name:'dried'},{name:'extra'},{name:'coa',maxCount:1}]);
const fl=(q,k)=>(q.files?.[k]||[]).map(f=>'/uploads/'+f.filename);
app.get('/api/my/strains',auth,(q,r)=>r.json(db.strains.filter(s=>s.userId==q.u.id&&!s.removed).map(pubS)));
app.post('/api/strains',auth,sf,toDb,(q,r)=>{const b=q.body;
 if(!b.name||!TYPES.includes(b.type)||!METHODS.includes(b.method))return r.status(400).json({error:'Name, strain type and grow method are required'});
 const flower=fl(q,'flower'),dried=fl(q,'dried');if(!flower.length||!dried.length)return r.status(400).json({error:'Add at least one photo of the plant in flower AND one of the dried bud'});
 const scS=scanText(b.name+' '+(b.description||''));const s={id:id(),userId:q.u.id,name:b.name.trim(),type:b.type,method:b.method,organic:b.organic=='true'||b.organic=='on',description:b.description||'',flowerPhotos:flower,driedPhotos:dried,extraPhotos:fl(q,'extra'),coa:fl(q,'coa')[0]||null,active:true,created:Date.now(),modHeld:scS.action=='hold'};if(scS.action!='clear')modLog('strain',s.id,q.u.id,b.name+' – '+(b.description||''),scS);photoFlag('strain',s.id,q.u.id,[...flower,...dried,...fl(q,'extra')]);
 db.strains.push(s);if(!s.modHeld)(db.posts=db.posts||[]).push({id:id(),userId:q.u.id,text:'Just listed a new strain for swapping: '+s.name,photos:[...flower,...dried],strainId:s.id,likes:[],at:Date.now()});save();r.json(pubS(s))});
app.post('/api/strains/:id',auth,sf,toDb,(q,r)=>{const s=S(q.params.id);if(!s||s.userId!=q.u.id)return r.status(404).json({error:'Not found'});const b=q.body;{const scE=scanText(((b.name||s.name)+' '+((b.description!=null?b.description:s.description)||'')));if(scE.action=='hold'){modLog('strain',s.id,q.u.id,(b.name||s.name)+' – '+(b.description||''),scE);save();return r.status(400).json({error:'Those listing changes were held for review by our moderation checks.'})}if(scE.action=='flag')modLog('strain',s.id,q.u.id,(b.name||s.name),scE)}
 if(b.name)s.name=b.name;if(TYPES.includes(b.type))s.type=b.type;if(METHODS.includes(b.method))s.method=b.method;if('organic'in b)s.organic=b.organic=='true'||b.organic=='on';if('description'in b)s.description=b.description;if('active'in b)s.active=b.active=='true';
 s.flowerPhotos.push(...fl(q,'flower'));s.driedPhotos.push(...fl(q,'dried'));s.extraPhotos.push(...fl(q,'extra'));if(fl(q,'coa')[0])s.coa=fl(q,'coa')[0];if(b.removeCoa)s.coa=null;if(b.remove){s.removed=true;s.active=false}save();r.json(pubS(s))});
app.get('/api/strains/:id',auth,(q,r)=>{const s=S(q.params.id);if(!s||s.removed)return r.status(404).json({error:'Not found'});if(s.modHeld&&s.userId!=q.u.id&&!q.u.admin)return r.status(404).json({error:'Not found'});if(s.userId!=q.u.id&&!hasActive(q.u.id))return r.status(403).json({error:'grower_only'});r.json(pubS(s))});
app.get('/api/browse',auth,grower,(q,r)=>{const{type,method,organic,province,town,q:t,lab,country,following,minrating}=q.query;
 let l=db.strains.filter(s=>s.active&&!s.modHeld&&s.userId!=q.u.id&&U(s.userId)&&!U(s.userId).banned);
 if(type)l=l.filter(s=>s.type==type);if(method)l=l.filter(s=>s.method==method);if(organic)l=l.filter(s=>s.organic);if(lab)l=l.filter(s=>s.coa);
 if(country)l=l.filter(s=>(U(s.userId).country||'South Africa')==country);if(province)l=l.filter(s=>U(s.userId).province==province);if(town)l=l.filter(s=>U(s.userId).town.toLowerCase().includes(town.toLowerCase()));
 if(t)l=l.filter(s=>matchQ([s.name,s.description,U(s.userId).name],t));if(minrating){const m=+minrating;l=l.filter(s=>{const o=avg(db.ratings.filter(r=>r.rateeId==s.userId).map(r=>r.memberStars)),f=avg(db.ratings.filter(r=>r.strainId==s.id).map(r=>r.flowerStars));return Math.max(o||0,f||0)>=m})}if(following)l=l.filter(s=>(db.follows||[]).some(f=>f.followerId==q.u.id&&f.followingId==s.userId));
 const d=s=>near(U(s.userId),q.u);
 l=l.map(s=>({...pubS(s),distance:NEAR[d(s)]}));
 l.sort(q.query.sort=='rating'?(a,b)=>(b.flowerRating||0)-(a.flowerRating||0):(a,b)=>NEAR.indexOf(a.distance)-NEAR.indexOf(b.distance)||(b.owner.rating||0)-(a.owner.rating||0));r.json(l)});
const P=()=>db.posts=db.posts||[],C=()=>db.comments=db.comments||[];
const nzQ=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,''),SYNQ={nl:'northernlights',dp:'durbanpoison',ww:'whitewidow',ogk:'ogkush'};
const matchQ=(parts,q)=>{let qn=nzQ(q);if(!qn)return true;qn=SYNQ[qn]||qn;const hay=nzQ(parts.join(' '));const toks=String(q).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>1).map(x=>SYNQ[x]||nzQ(x).replace(/s$/,''));return hay.includes(qn)||toks.length&&toks.every(t=>hay.includes(t))};
const pubP=(p,uid)=>({...p,held:!!p.modHeld,likes:p.likes.length,liked:p.likes.includes(uid),comments:C().filter(c=>c.postId==p.id).length,author:pubUv(U(p.userId),uid),strain:p.strainId&&S(p.strainId)&&!S(p.strainId).removed?pubS(S(p.strainId)):null});
app.get('/api/feed',auth,grower,(q,r)=>{const{type,method,organic,province,town,lab,q:t,country,following,minrating}=q.query;let l=P().filter(p=>U(p.userId)&&!U(p.userId).banned&&!heldFor(p,q.u.id,q.u.admin));
 const sf=type||method||organic||lab;if(sf)l=l.filter(p=>{const x=p.strainId&&S(p.strainId);return x&&x.active&&(!type||x.type==type)&&(!method||x.method==method)&&(!organic||x.organic)&&(!lab||x.coa)});
 if(country)l=l.filter(p=>(U(p.userId).country||'South Africa')==country);if(province)l=l.filter(p=>U(p.userId).province==province);if(town)l=l.filter(p=>U(p.userId).town.toLowerCase().includes(town.toLowerCase()));
 if(t)l=l.filter(p=>matchQ([p.text,p.strainId?S(p.strainId).name:'',U(p.userId).name],t));if(minrating){const m=+minrating;l=l.filter(p=>{const o=avg(db.ratings.filter(r=>r.rateeId==p.userId).map(r=>r.memberStars)),x=p.strainId?avg(db.ratings.filter(r=>r.strainId==p.strainId).map(r=>r.flowerStars)):null;return Math.max(o||0,x||0)>=m})}if(following)l=l.filter(p=>(db.follows||[]).some(f=>f.followerId==q.u.id&&f.followingId==p.userId));
 l=l.sort((a,b)=>b.at-a.at);if(q.query.sort=='rating')l.sort((a,b)=>(avg(db.ratings.filter(r=>r.rateeId==b.userId).map(r=>r.memberStars))||0)-(avg(db.ratings.filter(r=>r.rateeId==a.userId).map(r=>r.memberStars))||0)||b.at-a.at);if(q.query.sort=='near'){const d=p=>near(U(p.userId),q.u);l.sort((a,b)=>d(a)-d(b)||b.at-a.at)}
 r.json(l.slice(0,100).map(p=>pubP(p,q.u.id)))});
app.post('/api/posts',auth,grower,up.array('photos',20),toDb,(q,r)=>{const text=(q.body.text||'').trim().slice(0,3000),photos=(q.files||[]).map(f=>'/uploads/'+f.filename);if(!text&&!photos.length)return r.status(400).json({error:'Write something or add a photo'});
 const cid=(q.body.clientId||'').slice(0,64),dup=P().find(p=>p.userId==q.u.id&&((cid&&p.clientId==cid)||(!p.strainId&&p.text==text&&p.photos.length==photos.length&&Date.now()-p.at<60000)));
 if(dup){return r.json(pubP(dup,q.u.id))}
 const sc=scanText(text);const p={id:id(),userId:q.u.id,clientId:cid||null,text,photos,strainId:null,likes:[],at:Date.now(),modHeld:sc.action=='hold'};P().push(p);if(sc.action!='clear')modLog('post',p.id,q.u.id,text,sc);photoFlag('post',p.id,q.u.id,photos);save();r.json({...pubP(p,q.u.id),held:p.modHeld})});
app.post('/api/posts/:id/like',auth,(q,r)=>{const p=P().find(p=>p.id==q.params.id);if(!p)return r.status(404).json({error:'Not found'});const i=p.likes.indexOf(q.u.id);i<0?p.likes.push(q.u.id):p.likes.splice(i,1);save();r.json(pubP(p,q.u.id))});
app.get('/api/posts/:id/comments',auth,(q,r)=>r.json(C().filter(c=>c.postId==q.params.id&&!heldFor(c,q.u.id,q.u.admin)).map(c=>({...c,held:!!c.modHeld,author:pubU(U(c.userId))||{name:'Removed member'}}))));
app.post('/api/posts/:id/comments',auth,(q,r)=>{const p=P().find(p=>p.id==q.params.id),t=(q.body.text||'').trim();if(!p||!t)return r.status(400).json({error:'Empty'});const sc=scanText(t);const c={id:id(),postId:p.id,userId:q.u.id,text:t.slice(0,1000),at:Date.now(),modHeld:sc.action=='hold'};C().push(c);if(sc.action!='clear')modLog('comment',c.id,q.u.id,t,sc);save();r.json({ok:1,held:c.modHeld})});
app.post('/api/posts/:id/delete',auth,(q,r)=>{db.posts=P().filter(p=>!(p.id==q.params.id&&p.userId==q.u.id));save();r.json({ok:1})});
app.get('/api/users/:id/posts',auth,(q,r)=>r.json(P().filter(p=>p.userId==q.params.id).sort((a,b)=>b.at-a.at).map(p=>pubP(p,q.u.id))));
const REASONS=['Non-delivery','Selling / asking for money','Under 18','Fake photos/listing','Harassment/abuse','Other'];
function fileReport(by,o,reason,note,swapId){if(db.reports.some(x=>x.by==by&&x.against==o.id&&x.reason==reason))return{dup:1};
 db.reports.push({id:id(),by,against:o.id,reason,note:(note||'').slice(0,1000),swapId:swapId||null,at:Date.now(),status:'open'});try{notifyAdmins(`🚩 New report: ${reason} – ${o.name}`)}catch(e){}
 if(reason=='Non-delivery'){o.reports=(o.reports||0)+1;if(o.reports>=REPORT_LIMIT)removeUser(o)}return{ok:1}}
function removeUser(o){o.banned=true;o.deleted=true;db.strains.filter(s=>s.userId==o.id).forEach(s=>s.active=false);db.swaps.filter(x=>(x.aId==o.id||x.bId==o.id)&&x.status=='negotiating').forEach(x=>x.status='cancelled')}
app.post('/api/users/:id/report',auth,(q,r)=>{const o=U(q.params.id);if(!o||o.id==q.u.id)return r.status(400).json({error:'Cannot report this member'});const{reason,note,swapId}=q.body||{};
 if(!REASONS.includes(reason))return r.status(400).json({error:'Choose a reason'});
 if(reason=='Non-delivery'&&!db.swaps.some(w=>((w.aId==q.u.id&&w.bId==o.id)||(w.bId==q.u.id&&w.aId==o.id))&&['agreed','completed'].includes(w.status)))return r.status(400).json({error:'Non-delivery can only be reported on an agreed swap with this member'});
 const x=fileReport(q.u.id,o,reason,note,swapId);if(x.dup)return r.status(400).json({error:'You already reported this member for that reason'});save();r.json({ok:1,removed:!!o.banned})});
const admin=(q,r,n)=>q.u.admin?n():r.status(403).json({error:'Admins only'});
app.post('/api/admin/users/:id/delete',auth,admin,(q,r)=>{const i=+q.params.id,u=db.users.find(x=>x.id==i);if(!u||u.admin)return r.status(400).json({error:'Cannot delete'});
 db.users=db.users.filter(x=>x.id!=i);db.strains=db.strains.filter(x=>x.userId!=i);db.posts=(db.posts||[]).filter(x=>x.userId!=i);db.comments=(db.comments||[]).filter(x=>x.userId!=i);db.follows=(db.follows||[]).filter(x=>x.followerId!=i&&x.followingId!=i);db.users.forEach(x=>{if(x.invitedBy==i)x.invitedBy=null});save();r.json({ok:1})});
app.get('/api/admin/moderation',auth,admin,(q,r)=>r.json((db.modflags||[]).slice().reverse().slice(0,100).map(f=>({...f,author:pubU(U(f.authorId))||{name:'Removed member'},contextUrl:f.kind=='message'?(()=>{const m=db.messages.find(x=>x.id==f.contentId);return m?'#/c/'+(m.userId==f.authorId? (db.swaps.find(w=>w.id==m.swapId)?(db.swaps.find(w=>w.id==m.swapId).aId==f.authorId?db.swaps.find(w=>w.id==m.swapId).bId:db.swaps.find(w=>w.id==m.swapId).aId):null):null):null})():f.kind=='post'?'#/browse':f.kind=='strain'?'#/strain/'+f.contentId:f.kind=='profile'?'#/user/'+f.authorId:null}))));
app.post('/api/admin/moderation/:id',auth,admin,(q,r)=>{const f=(db.modflags||[]).find(x=>x.id==q.params.id);if(!f)return r.status(404).json({error:'Not found'});const act=q.body.action,a=U(f.authorId);
 const item=f.kind=='message'?db.messages.find(x=>x.id==f.contentId):f.kind=='post'?P().find(x=>x.id==f.contentId):f.kind=='comment'?C().find(x=>x.id==f.contentId):f.kind=='strain'?S(f.contentId):null;
 const del=()=>{if(f.kind=='message')db.messages=db.messages.filter(x=>x.id!=f.contentId);if(f.kind=='post')db.posts=P().filter(x=>x.id!=f.contentId);if(f.kind=='comment')db.comments=C().filter(x=>x.id!=f.contentId);if(f.kind=='strain'&&item){item.removed=true;item.active=false}};
 if(act=='approve'){if(item)item.modHeld=false;f.status='approved'}
 else if(act=='delete'){del();f.status='deleted';if(a)try{notify(a.id,'moderation',{title:'Bud Share',body:'Content you shared was removed under our community rules.',url:'#/profile',tag:'mod-'+f.id})}catch(e){}}
 else if(act=='warn'){f.status='warned';if(a)try{notify(a.id,'moderation',{title:'Bud Share',body:'Warning: please follow the Bud Share community rules (no sales, no sexual content, no threats). Further issues may remove your account.',url:'#/profile',tag:'modwarn-'+f.id})}catch(e){}}
 else if(act=='ban'){del();f.status='banned';if(a)removeUser(a)}
 else return r.status(400).json({error:'Unknown action'});
 f.decidedBy=q.u.id;f.decidedAt=Date.now();save();r.json({ok:1,status:f.status})});
app.get('/api/admin/reports',auth,admin,(q,r)=>r.json(db.reports.slice().reverse().map(x=>{const a=db.users.find(u=>u.id==x.against),b=db.users.find(u=>u.id==x.by);return{...x,status:x.status||'open',againstUser:a&&{id:a.id,name:a.name,email:a.email,banned:!!a.banned,strikes:a.reports||0},byUser:b&&{id:b.id,name:b.name}}})));
app.post('/api/admin/reports/:id',auth,admin,(q,r)=>{const x=db.reports.find(x=>x.id==q.params.id);if(!x)return r.status(404).json({error:'Not found'});
 if(q.body.action=='resolve')x.status='resolved';if(q.body.action=='remove'){const o=db.users.find(u=>u.id==x.against);o&&removeUser(o);x.status='resolved'}save();r.json({ok:1})});
// swaps
const pairKey=(a,b)=>Math.min(a,b)+'-'+Math.max(a,b);const swapPair=sid=>{const w=db.swaps.find(x=>x.id==sid);return w?pairKey(w.aId,w.bId):null};
const msg=(swapId,userId,type,o={})=>{const m={id:id(),swapId,pair:swapPair(swapId),userId,type,at:Date.now(),...o};db.messages.push(m);try{notifyMsg(m)}catch(e){console.error('notify',e.message)}return m};
const swapView=(w,uid)=>{const mine=w.aId==uid,other=U(mine?w.bId:w.aId)||{id:0,name:'Removed member'};
 return{...w,me:mine?'a':'b',other:pubU(other)||{name:'Removed member'},myStrain:pubS(S(mine?w.aStrain:w.bStrain)),theirStrain:pubS(S(mine?w.bStrain:w.aStrain)),myGrams:mine?w.aGrams:w.bGrams,theirGrams:mine?w.bGrams:w.aGrams,iAccepted:mine?w.accA:w.accB,theyAccepted:mine?w.accB:w.accA,myReceipt:mine?w.recA:w.recB,myShip:(mine?w.shipA:w.shipB)||null,theirShip:(mine?w.shipB:w.shipA)||null,theirReceipt:mine?w.recB:w.recA,iRated:db.ratings.some(x=>x.swapId==w.id&&x.raterId==uid),lastMsg:db.messages.filter(m=>m.swapId==w.id).slice(-1)[0],unread:db.messages.filter(m=>m.swapId==w.id&&m.userId!=uid&&m.at>((mine?w.seenA:w.seenB)||0)).length}};
const SW=(q,r)=>{const w=db.swaps.find(w=>w.id==q.params.id&&(w.aId==q.u.id||w.bId==q.u.id));if(!w)r.status(404).json({error:'Not found'});return w};

// ---------- content moderation (rules-based text scan; photos are NOT auto-scanned)
const LEET={'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i'};
const norm=t=>{let x=String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\u200b-\u200d\ufeff]/g,'');x=x.replace(/[013457@$!]/g,c=>LEET[c]||c);return x.replace(/\s+/g,' ')};
const squeeze=t=>norm(t).replace(/[^a-z0-9]/g,'');
const NEG=/(not for sale|no selling|no sales|not selling|no money|no cash|free swap|swap(s|ping)? only|trade only|no payment)/;
function scanText(raw){
 const terms=[];let score=0,cat=null,hard=false;const t=norm(raw),sq=squeeze(raw);
 const hit=(re,label,w,c,h)=>{const m=t.match(re)||(sq.includes(label.replace(/[^a-z0-9]/g,''))&&label.length>4);if(m){terms.push(label);score+=w;if(c)cat=c;if(h)hard=true;return true}return false};
 // (3) minors + sexual = highest priority, immediate hold
 if(/(under\s?-?\s?age|minor|child|kid|teen|school\s?(girl|boy)|young\s?(girl|boy)|pre\s?teen)/.test(t)&&/(sex|nude|naked|porn|pic|photo|image|video|touch|meet)/.test(t)||/(child\s?porn|cp\s+video|jailbait)/.test(t)||sq.includes('underagesex')){return{action:'hold',category:'Minors / underage sexual content',score:100,terms:['minor + sexual content']}}
 // threats
 if(hit(/\b(kill|shoot|stab|murder|burn|bomb|beat up|hurt)\s+(you|u|him|her|them)\b/,'threat of violence',90,'Threats',true)||hit(/\bi('ll| will)\s+(kill|shoot|stab|find|come for|hurt)/,'threat (I will …)',90,'Threats',true))return{action:'hold',category:cat||'Threats',score,terms};
 // (2) sexual / pornographic / solicitation
 let sex=0;const sexTerms=[[/\b(send|share|trade|got|any)\s+(me\s+)?(nudes?|naked\s?pics?|dick\s?pics?|sex\s?tapes?)\b/,'nude/solicitation',40],[/\b(blow\s?job|hand\s?job|porn|xxx|onlyfans|sex\s?for|hook\s?up\s+for\s+sex|horny|erotic|fetish)\b/,'explicit sexual',35],[/\bsexy\b/,'sexy (weak)',6],[/\bnudes?\b/,'nudes',25]];
 for(const[re,l,w]of sexTerms)if(hit(re,l,w,'Sexual content'))sex+=w;
 if(sex>=30)return{action:'hold',category:'Sexual content / solicitation',score:sex,terms};
 // (1) selling / commercial — strip negated sentences first ("not for sale" etc.)
 const clean=t.split(/(?<=[.!?])\s+/).filter(x=>!NEG.test(x)).join(' ');
 const money=/\b(r\s?\d[\d\s.,]*|\$\s?\d[\d.,]*|zar\s?\d+|usd\s?\d+)\b/.test(String(raw||'').toLowerCase())||/\br[0-9so]{2,}\b/.test(clean),pay=/(eft|payfast|snapscan|e-?wallet|capitec|fnb|absa|nedbank|standard bank|cash app|cashapp|paypal|venmo|bank transfer|bank details|deposit|pay me|payment)/.test(clean);
 let sell=0;const st=[[/\bfor sale\b/,'for sale',8],[/\bsell(ing)?\b/,'selling',6],[/\bbuy(ing)?\b/,'buying',3],[/\bprice[sd]?\b/,'price',5],[/\bcost(s)?\b.*\br\d/,'cost + amount',4],[/\bdm\s+(me\s+)?for\s+(price|details|cost)\b/,'DM for price',9],[/\bwhatsapp\s+me\b/,'WhatsApp me (off-platform)',7],[/\b(call|text|phone|contact)\s+me\b/,'contact me off-platform',3],[/\bper\s+(gram|g|10g|doos|bankie)\b/,'per-gram pricing',6],[/\b(bankie|doos|zol|dagga)\s+for\s+sale\b/,'SA slang: for sale',8]];
 for(const[re,l,w]of st){const m=clean.match(re);if(m){terms.push(l);sell+=w}}
 if(/(^|[\s,])0[1-9]\d{8}\b/.test(String(raw||''))||/\+27\s?\d{9}/.test(String(raw||''))){terms.push('phone number');sell+=4}
 if(money){terms.push('currency amount');sell+=6}
 if(pay){terms.push('payment method');sell+=6}
 if(squeeze(clean).includes('dmforprice')||squeeze(clean).includes('forsale')){terms.push('obfuscated selling phrase');sell+=6}
 if(money&&(pay||sell>=5))sell+=4; // amount + payment/context = strong
 if(sell>=10)return{action:'hold',category:'Selling / commercial',score:sell,terms};
 if(sex>0)return{action:'flag',category:'Sexual content',score:sex,terms};
 if(sell>=3)return{action:'flag',category:'Selling / commercial (possible)',score:sell,terms};
 return{action:'clear',score:0,terms:[]}}
function modLog(kind,contentId,authorId,text,scan,status,extra={}){db.modflags=db.modflags||[];const f={id:id(),kind,contentId,authorId,text:String(text||'').slice(0,1000),category:scan.category||null,score:scan.score||0,terms:scan.terms||[],action:scan.action,status:status||(scan.action=='hold'?'pending':'flagged'),at:Date.now(),...extra};db.modflags.push(f);
 if(scan.action!='clear'&&kind!=='photo')try{notifyAdmins(`🛡 Moderation (${f.category||'flag'}): ${U(authorId)?.name||'member'} – ${f.kind}`,'#/admin')}catch(e){}
 return f}
function photoFlag(kind,contentId,authorId,photos){if(!photos||!photos.length)return;modLog(kind,contentId,authorId,'[photo upload – not auto-scanned]',{action:'flag',category:'Photo (manual review – photos are not auto-scanned)',score:1,terms:['photo upload']},'photo',{photos})}
const heldFor=(item,uid,admin)=>!!item.modHeld&&item.userId!=uid&&!admin;
// ---------- notifications (Web Push + optional email fallback behind a provider interface)
const webpush=require('web-push');const VAPID={pub:process.env.VAPID_PUBLIC_KEY,priv:process.env.VAPID_PRIVATE_KEY,subj:process.env.VAPID_SUBJECT||'https://app.budshare.co.za'};
if(VAPID.pub&&VAPID.priv)webpush.setVapidDetails(VAPID.subj,VAPID.pub,VAPID.priv);
const NTYPES={message:'New chat messages',offer:'New swap offers',counter:'Counter-offers',agreed:'Deal agreed',courier:'Courier / tracking shared',received:'Parcel marked received / not received',rating:'New ratings',follow:'Someone follows you',moderation:'Moderation decisions about your content',admin:'Admin: new reports & reviews'};
const nprefs=u=>{const p=u.notif||{};const types={};for(const k in NTYPES)types[k]=p.types?.[k]!==false;return{types,previews:p.previews!==false,email:!!p.email}};
// presence: which conversation a member is actively viewing (from chat polling while visible)
const presence=new Map();const viewing=(uid,oid)=>{const p=presence.get(uid);return p&&p.oid==oid&&Date.now()-p.at<9000};
// email provider interface – disabled unless EMAIL_PROVIDER + EMAIL_API_KEY + EMAIL_FROM are configured
const EMAIL={provider:process.env.EMAIL_PROVIDER||'',key:process.env.EMAIL_API_KEY||'',from:process.env.EMAIL_FROM||''};
const emailProviders={
 resend:async(to,subj,text)=>fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+EMAIL.key,'Content-Type':'application/json'},body:JSON.stringify({from:EMAIL.from,to:[to],subject:subj,text})}),
 brevo:async(to,subj,text)=>fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':EMAIL.key,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:EMAIL.from,name:'Bud Share'},to:[{email:to}],subject:subj,textContent:text})}),
};
const sendEmail=async(u,subj,text)=>{const f=emailProviders[EMAIL.provider];if(!f||!EMAIL.key||!EMAIL.from)return false;try{const r=await f(u.email,subj,text);return r.ok}catch(e){return false}};
async function pushTo(uid,payload){const subs=(db.pushsubs||[]).filter(s=>s.userId==uid);let sent=0;
 for(const s of subs){try{await webpush.sendNotification(s.sub,JSON.stringify(payload),{TTL:3600,urgency:'normal',topic:(payload.tag||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,32)||undefined});s.lastOk=Date.now();sent++}
  catch(e){if(e.statusCode==404||e.statusCode==410){db.pushsubs=db.pushsubs.filter(x=>x!==s)}else console.error('push',e.statusCode||e.message)}}
 if(sent||subs.length)save();return sent}
// burst grouping: per member+tag, max one push per 20s; extra events are summarised in a follow-up
const bursts=new Map();
function notify(uid,type,{title,body,url,tag,from}){const u=U(uid);if(!u||u.banned)return;const p=nprefs(u);if(!p.types[type])return;
 const t=p.previews?title:'Bud Share',b=p.previews?body:'You have a new notification';const k=uid+'|'+tag,now=Date.now(),st=bursts.get(k);
 const fire=(n)=>{const payload={title:t,body:n>1&&p.previews?`${n} new updates – latest: ${b}`:n>1?`${n} new notifications`:b,url,tag,ts:Date.now()};
  if(!VAPID.pub)return;pushTo(uid,payload).then(sent=>{if(!sent&&p.email)sendEmail(u,'Bud Share: '+payload.title,payload.body+'\n\nOpen Bud Share: https://app.budshare.co.za/'+(url||''))})};
 if(st&&now-st.at<20000){st.n++;st.last=b;if(!st.timer)st.timer=setTimeout(()=>{const x=bursts.get(k);bursts.set(k,{at:Date.now(),n:0});if(x&&x.n)fire(x.n+0)},20000-(now-st.at));return}
 bursts.set(k,{at:now,n:0});fire(1)}
function notifyMsg(m){if(m.modHeld)return;const w=db.swaps.find(x=>x.id==m.swapId);if(!w)return;const to=m.userId==w.aId?w.bId:w.aId,from=U(m.userId);if(!from)return;if(viewing(to,m.userId))return;
 let type=null,body='';const sw=`Swap #${w.id}`;
 if(m.type=='text'){type='message';body=m.text}
 else if(m.type=='offer'){type=/^Counter/.test(m.text)?'counter':'offer';body=m.text}
 else if(m.type=='courier'){type='courier';body=`📦 Shared tracking for ${(m.swapIds||[w.id]).map(i=>'#'+i).join(', ')}: ${m.courier}`}
 else if(m.type=='system'){const x=m.text||'';if(/^✅ Deal agreed/.test(x)){type='agreed';body=x}else if(/^📦 Parcel marked as received/.test(x)){type='received';body=`${sw}: marked your parcel as received`}else if(/NOT received/.test(x)){type='received';body=`${sw}: marked parcel NOT received`}else if(/^⭐ Rated/.test(x)){type='rating';body=`${sw}: ${x.replace('⭐ ','')}`}}
 if(!type)return;notify(to,type,{title:from.name,body:String(body).slice(0,140),url:'#/c/'+m.userId,tag:'conv-'+Math.min(to,m.userId)+'-'+Math.max(to,m.userId)})}
function notifyAdmins(body,url){db.users.filter(u=>u.admin).forEach(a=>notify(a.id,'admin',{title:'Bud Share admin',body,url:url||'#/admin',tag:'admin'}))}
app.get('/api/push/config',auth,(q,r)=>r.json({publicKey:VAPID.pub||null,types:NTYPES,prefs:nprefs(q.u),devices:(db.pushsubs||[]).filter(s=>s.userId==q.u.id).length,email:!!(emailProviders[EMAIL.provider]&&EMAIL.key&&EMAIL.from)}));
app.post('/api/push/subscribe',auth,(q,r)=>{const sub=q.body?.sub;if(!sub?.endpoint||!sub.keys?.p256dh||!sub.keys?.auth)return r.status(400).json({error:'Invalid subscription'});db.follows=db.follows||[];db.pushsubs=db.pushsubs||[];
 const ex=db.pushsubs.find(s=>s.sub.endpoint==sub.endpoint);if(ex){ex.userId=q.u.id;ex.sub=sub;ex.at=Date.now()}else db.pushsubs.push({id:id(),userId:q.u.id,sub,ua:String(q.headers['user-agent']||'').slice(0,160),at:Date.now()});save();r.json({ok:1})});
app.post('/api/push/unsubscribe',auth,(q,r)=>{const e=q.body?.endpoint;db.pushsubs=(db.pushsubs||[]).filter(s=>!(s.userId==q.u.id&&(!e||s.sub.endpoint==e)));save();r.json({ok:1})});
app.post('/api/me/notif',auth,(q,r)=>{const b=q.body||{};const cur=nprefs(q.u);const types={...cur.types};for(const k in NTYPES)if(k in (b.types||{}))types[k]=!!b.types[k];q.u.notif={types,previews:'previews' in b?!!b.previews:cur.previews,email:'email' in b?!!b.email:cur.email};save();r.json({ok:1,prefs:nprefs(q.u)})});
app.post('/api/push/test',auth,async(q,r)=>{const n=await pushTo(q.u.id,{title:'Bud Share',body:'✅ Notifications are working on this device',url:'#/profile',tag:'test',ts:Date.now()});r.json({ok:1,sent:n})});
const u18ok=u=>!!u.dob&&!isNaN(new Date(u.dob))&&age(u.dob)>=18;
// existing members without a DOB are asked on next login; under-18 -> account removed
app.post('/api/me/dob',auth,(q,r)=>{const d=String(q.body?.dob||'');if(isNaN(new Date(d)))return r.status(400).json({error:'Enter a valid date of birth'});
 if(age(d)<18){q.u.dob=d;removeUser(q.u);db.reports.push({id:id(),by:q.u.id,against:q.u.id,reason:'Under 18',note:'Self-declared DOB under 18 at login prompt',at:Date.now(),status:'open'});save();q.session=null;return r.status(403).json({error:'Bud Share is for adults 18+ only. Your account has been closed.'})}
 q.u.dob=d;q.u.dobConfirmedAt=Date.now();save();r.json({ok:1})});
app.post('/api/swaps',auth,grower,(q,r)=>{const{myStrain,myGrams,theirStrain,theirGrams,note}=q.body;const m=S(myStrain),t=S(theirStrain);
 if(!m||m.userId!=q.u.id||!m.active||!t||!t.active||t.userId==q.u.id)return r.status(400).json({error:'Pick one of your strains and one of theirs'});
 if(!(myGrams>0&&theirGrams>0))return r.status(400).json({error:'Enter grams for both sides'});
 const w={id:id(),aId:q.u.id,bId:t.userId,aStrain:m.id,bStrain:t.id,aGrams:+myGrams,bGrams:+theirGrams,accA:true,accB:false,status:'negotiating',recA:null,recB:null,created:Date.now()};db.swaps.push(w);
 msg(w.id,q.u.id,'offer',{text:`Offer: ${w.aGrams}g of ${m.name} for ${w.bGrams}g of ${t.name}`,aGrams:w.aGrams,bGrams:w.bGrams});if(note)msg(w.id,q.u.id,'text',{text:note});save();r.json({id:w.id})});
app.get('/api/swaps',auth,(q,r)=>r.json(db.swaps.filter(w=>w.aId==q.u.id||w.bId==q.u.id).map(w=>swapView(w,q.u.id)).sort((a,b)=>(b.lastMsg?.at||0)-(a.lastMsg?.at||0))));
app.get('/api/swaps/:id',auth,(q,r)=>{const w=SW(q,r);if(!w)return;r.json({swap:swapView(w,q.u.id),lastRead:w[w.aId==q.u.id?'seenA':'seenB']||0,messages:db.messages.filter(m=>m.swapId==w.id)})});
app.post('/api/swaps/:id/read',auth,(q,r)=>{const w=SW(q,r);if(!w)return;const k=w.aId==q.u.id?'seenA':'seenB',t=Math.min(Date.now(),+q.body?.upTo||Date.now());if(t>(w[k]||0)){w[k]=t;save()}r.json({ok:1,lastRead:w[k]})});
app.post('/api/swaps/:id/counter',auth,(q,r)=>{const w=SW(q,r);if(!w)return;if(w.status!='negotiating')return r.status(400).json({error:'Deal already agreed'});
 const a=w.aId==q.u.id,mg=+q.body.myGrams,tg=+q.body.theirGrams;if(!(mg>0&&tg>0))return r.status(400).json({error:'Enter grams for both sides'});
 if(a){w.aGrams=mg;w.bGrams=tg}else{w.bGrams=mg;w.aGrams=tg}w.accA=a;w.accB=!a;
 msg(w.id,q.u.id,'offer',{text:`Counter-offer: ${mg}g of ${S(a?w.aStrain:w.bStrain).name} for ${tg}g of ${S(a?w.bStrain:w.aStrain).name}`});save();r.json({ok:1})});
app.post('/api/swaps/:id/accept',auth,(q,r)=>{const w=SW(q,r);if(!w)return;if(w.status!='negotiating')return r.status(400).json({error:'Not negotiable now'});
 w[w.aId==q.u.id?'accA':'accB']=true;if(w.accA&&w.accB){w.status='agreed';msg(w.id,q.u.id,'system',{text:`✅ Deal agreed: ${w.aGrams}g ${S(w.aStrain).name} ⇄ ${w.bGrams}g ${S(w.bStrain).name}. Share your courier & tracking details below.`});msg(w.id,q.u.id,'system',{text:'⚠️ '+DISCLAIMER})}else msg(w.id,q.u.id,'system',{text:'Accepted the offer'});save();r.json({ok:1})});
app.post('/api/swaps/:id/decline',auth,(q,r)=>{const w=SW(q,r);if(!w)return;if(w.status!='negotiating')return r.status(400).json({error:'Cannot cancel after deal agreed'});w.status='cancelled';msg(w.id,q.u.id,'system',{text:'❌ Swap cancelled'});save();r.json({ok:1})});
app.post('/api/swaps/:id/messages',auth,(q,r)=>{const w=SW(q,r);if(!w)return;if(w.status=='cancelled')return r.status(400).json({error:'Swap cancelled'});const{text,courier,tracking,notes}=q.body;
 if(courier||tracking){if(w.status=='negotiating')return r.status(400).json({error:'Agree the deal first'});if(!courier||!tracking)return r.status(400).json({error:'Courier and tracking number required'});const sk=w.aId==q.u.id?'shipA':'shipB',prev=w[sk];w[sk+'History']=(w[sk+'History']||[]).concat(prev?[prev]:[]);w[sk]={courier,tracking,at:Date.now()};r.json(msg(w.id,q.u.id,'courier',{courier,tracking,notes:notes||'',updated:!!prev}))}
 else{if(!text?.trim())return r.status(400).json({error:'Empty'});w[w.aId==q.u.id?'seenA':'seenB']=Date.now();const sc=scanText(text);const m=msg(w.id,q.u.id,'text',{text:text.trim().slice(0,2000),modHeld:sc.action=='hold'});if(sc.action!='clear')modLog('message',m.id,q.u.id,text,sc);save();r.json({...m,held:sc.action=='hold'})}});

// ---- conversations: one chat per member pair, spanning all their swaps
const pairSwaps=(uid,oid)=>db.swaps.filter(w=>(w.aId==uid&&w.bId==oid)||(w.aId==oid&&w.bId==uid)).sort((a,b)=>a.created-b.created);
const seenK=(w,uid)=>w.aId==uid?'seenA':'seenB';
const isUnread=(m,uid)=>{if(m.userId==uid)return false;const w=db.swaps.find(x=>x.id==m.swapId);return !!w&&m.at>(w[seenK(w,uid)]||0)};
const swapLabel=w=>`Swap #${w.id}: ${w.aGrams}g ${S(w.aStrain)?.name||'?'} ⇄ ${w.bGrams}g ${S(w.bStrain)?.name||'?'}`;
const convMsgs=(uid,oid)=>{const ws=pairSwaps(uid,oid),ids=new Set(ws.map(w=>w.id)),k=pairKey(uid,oid);const me=U(uid);return db.messages.filter(m=>(m.pair==k||ids.has(m.swapId))&&!(m.modHeld&&m.userId!=uid&&!me?.admin)).sort((a,b)=>a.at-b.at||a.id-b.id)};
app.get('/api/convs',auth,(q,r)=>{const by={};for(const w of db.swaps){if(w.aId!=q.u.id&&w.bId!=q.u.id)continue;const o=w.aId==q.u.id?w.bId:w.aId;(by[o]=by[o]||[]).push(w)}
 r.json(Object.entries(by).map(([o,ws])=>{const ms=convMsgs(q.u.id,+o),last=ms[ms.length-1];const views=ws.map(w=>swapView(w,q.u.id));
  return{otherId:+o,other:views[0].other,swaps:views.map(v=>({id:v.id,status:v.status,myStrain:v.myStrain?.name,theirStrain:v.theirStrain?.name})),active:views.filter(v=>['negotiating','agreed'].includes(v.status)).length,lastMsg:last||null,unread:ms.filter(m=>isUnread(m,q.u.id)).length}}).sort((a,b)=>(b.lastMsg?.at||0)-(a.lastMsg?.at||0)))});
app.get('/api/convs/:oid',auth,(q,r)=>{if(q.query.vis=='1')presence.set(q.u.id,{oid:+q.params.oid,at:Date.now()});const oid=+q.params.oid,ws=pairSwaps(q.u.id,oid);if(!ws.length)return r.status(404).json({error:'No chat with this member yet'});
 const multi=ws.length>1,lab=Object.fromEntries(ws.map(w=>[w.id,swapLabel(w)]));
 r.json({other:swapView(ws[0],q.u.id).other,swaps:ws.map(w=>swapView(w,q.u.id)),messages:convMsgs(q.u.id,oid).map(m=>({...m,held:!!m.modHeld,unread:isUnread(m,q.u.id),swapLabel:(m.swapIds||[m.swapId]).map(i=>lab[i]?`Swap #${i}`:'').filter(Boolean).join(' + '),swapFull:lab[m.swapId]||''}))})});
app.post('/api/convs/:oid/read',auth,(q,r)=>{const ws=pairSwaps(q.u.id,+q.params.oid),t=Math.min(Date.now(),+q.body?.upTo||Date.now());ws.forEach(w=>{const k=seenK(w,q.u.id);if(t>(w[k]||0))w[k]=t});save();r.json({ok:1})});
app.post('/api/convs/:oid/messages',auth,(q,r)=>{const ws=pairSwaps(q.u.id,+q.params.oid);if(!ws.length)return r.status(404).json({error:'Not found'});const text=String(q.body?.text||'').trim();if(!text)return r.status(400).json({error:'Empty'});
 const w=[...ws].reverse().find(x=>['negotiating','agreed'].includes(x.status))||ws[ws.length-1];ws.forEach(x=>x[seenK(x,q.u.id)]=Date.now());const sc=scanText(text);const m=msg(w.id,q.u.id,'text',{text:text.slice(0,2000),modHeld:sc.action=='hold'});if(sc.action!='clear')modLog('message',m.id,q.u.id,text,sc);save();r.json({...m,held:sc.action=='hold'})});
app.post('/api/convs/:oid/courier',auth,(q,r)=>{const ws=pairSwaps(q.u.id,+q.params.oid);const{courier,tracking,notes}=q.body||{};const ids=[].concat(q.body?.swapIds||[]).map(Number);
 const sel=ws.filter(w=>ids.includes(w.id));if(!sel.length)return r.status(400).json({error:'Choose at least one swap'});if(sel.some(w=>!['agreed','completed'].includes(w.status)))return r.status(400).json({error:'Agree the deal first'});if(!courier||!tracking)return r.status(400).json({error:'Courier and tracking number required'});
 let upd=false;sel.forEach(w=>{const sk=w.aId==q.u.id?'shipA':'shipB',prev=w[sk];if(prev)upd=true;w[sk+'History']=(w[sk+'History']||[]).concat(prev?[prev]:[]);w[sk]={courier,tracking,at:Date.now()}});
 const m=msg(sel[0].id,q.u.id,'courier',{courier,tracking,notes:notes||'',updated:upd,swapIds:sel.map(w=>w.id)});save();r.json(m)});
app.post('/api/swaps/:id/receipt',auth,(q,r)=>{const w=SW(q,r);if(!w)return;if(!['agreed','completed'].includes(w.status))return r.status(400).json({error:'Deal not agreed yet'});
 const a=w.aId==q.u.id,k=a?'recA':'recB';if(w[k])return r.status(400).json({error:'Already marked'});const v=q.body.received?'received':'not_received';if(v=='not_received'&&!(a?w.shipB:w.shipA))return r.status(400).json({error:'You can report non-delivery once the other member has shared tracking'});w[k]=v;
 if(v=='not_received'){const o=U(a?w.bId:w.aId);const res=o?fileReport(q.u.id,o,'Non-delivery',q.body.reason||'',w.id):{};
  msg(w.id,q.u.id,'system',{text:`⚠️ Parcel marked NOT received – member reported (${o?.reports||'?'}/${REPORT_LIMIT})`+(o?.banned?'. Member removed from Bud Share.':'')})}
 else msg(w.id,q.u.id,'system',{text:'📦 Parcel marked as received'});
 if(w.recA&&w.recB)w.status='completed';save();r.json({ok:1})});
app.post('/api/swaps/:id/rate',auth,(q,r)=>{const w=SW(q,r);if(!w)return;const a=w.aId==q.u.id;
 if((a?w.recA:w.recB)!='received')return r.status(400).json({error:'Only members who received the flower can rate it'});if(db.ratings.some(x=>x.swapId==w.id&&x.raterId==q.u.id))return r.status(400).json({error:'Already rated'});
 const f=+q.body.flowerStars,m=+q.body.memberStars;if(!(f>=1&&f<=5&&m>=1&&m<=5))return r.status(400).json({error:'Choose 1–5 stars for both'});
 db.ratings.push({id:id(),swapId:w.id,raterId:q.u.id,rateeId:a?w.bId:w.aId,strainId:a?w.bStrain:w.aStrain,flowerStars:f,memberStars:m,comment:q.body.comment||'',at:Date.now()});
 msg(w.id,q.u.id,'system',{text:`⭐ Rated flower ${f}/5 and member ${m}/5`});save();r.json({ok:1})});
app.get('/api/strains/:id/reviews',auth,(q,r)=>r.json(db.ratings.filter(x=>x.strainId==q.params.id).map(x=>({...x,rater:pubU(U(x.raterId))||{name:'Removed member'}}))));
app.use((q,r)=>{r.set('Cache-Control','no-cache, no-store, must-revalidate');r.sendFile(path.join(__dirname,'public/index.html'))});
app.use((e,q,r,n)=>r.status(500).json({error:e.message}));
(async()=>{fs.mkdirSync(path.join(__dirname,'uploads'),{recursive:true});
 let ok=false;for(let i=1;i<=6;i++){try{ok=await store.init();break}catch(e){console.error(`DB connect failed (attempt ${i}/6):`,e.code||e.message);if(i==6)process.exit(1);await new Promise(r=>setTimeout(r,5000*i))}}
 if(ok){db=await store.load();
  if(!db.users.length){console.log('DB empty - seeding demo data');require('child_process').execSync('node seed.js',{cwd:__dirname,stdio:'inherit'});db=JSON.parse(fs.readFileSync(DBF));
   console.log('imported files',await store.importDir(path.join(__dirname,'uploads')));await store.flushNow(db)}
 db.pushsubs=db.pushsubs||[]; db.posts=db.posts||[];db.comments=db.comments||[];db.reports=db.reports||[];console.log('Loaded from Postgres:',store.COLLS.map(c=>c+'='+(db[c]||[]).length).join(' '))}
 else{if(!fs.existsSync(DBF))require('child_process').execSync('node seed.js',{cwd:__dirname,stdio:'inherit'});db=JSON.parse(fs.readFileSync(DBF))}
 db.users.forEach(u=>{code(u);if(!u.country)u.country='South Africa'});
 {let n=0;db.messages.forEach(m=>{if(!m.pair){const k=swapPair(m.swapId);if(k){m.pair=k;n++}}});if(n){console.log('conv-migrate: tagged',n,'messages with pair key');save()}}
 if(process.env.ADMIN_PASSWORD){const ad=db.users.find(u=>u.admin);if(ad&&!bcrypt.compareSync(process.env.ADMIN_PASSWORD,ad.pw)){ad.pw=bcrypt.hashSync(process.env.ADMIN_PASSWORD,10);console.log('Admin password synced from env')}}
 if(!db.secret){db.secret=crypto.randomBytes(8).toString('hex')}save();
 app.listen(process.env.PORT||3300,()=>console.log('Bud Share on',process.env.PORT||3300))})();
