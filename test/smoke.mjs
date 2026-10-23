// in-memory PostgREST stand-in to smoke-test the Worker without Supabase
import worker from '../src/worker.js';
const T = {}; let seq = 1;
const PK = { users:'id', sessions:'token_hash', listings:'id', scores:'user_id,game', agreements:'agr_id', reviews:'agr_id', payments:'agr_id' };
const match=(r,f)=>[...f].every(([k,v])=>{ if(['order','limit','on_conflict'].includes(k))return true;
  if(v.startsWith('eq.'))return String(r[k])===v.slice(3); if(v.startsWith('in.('))return v.slice(4,-1).split(',').includes(String(r[k])); return true;});
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const t = u.pathname.split('/').pop().replace(/^r423_/,'');
  if (!u.pathname.includes('r423_')) throw new Error('unprefixed table '+u.pathname);
  T[t]=T[t]||[]; const m=init.method; const body=init.body?JSON.parse(init.body):null; let out;
  if(m==='GET'){ out=T[t].filter(r=>match(r,u.searchParams)); const o=u.searchParams.get('order'); if(o){const[c,d]=o.split('.');out=[...out].sort((a,b)=>(a[c]>b[c]?1:-1)*(d==='desc'?-1:1));} const l=u.searchParams.get('limit'); if(l)out=out.slice(0,+l);}
  else if(m==='POST'){ const oc=u.searchParams.get('on_conflict'); if(oc){const ks=oc.split(','); const i=T[t].findIndex(r=>ks.every(k=>r[k]===body[k])); if(i>=0)Object.assign(T[t][i],body); else T[t].push({...body}); out=[body];} else { const row={...body}; if(t==='messages')row.id=seq++; T[t].push(row); out=[row]; } }
  else if(m==='PATCH'){ out=T[t].filter(r=>match(r,u.searchParams)); out.forEach(r=>Object.assign(r,body)); }
  else if(m==='DELETE'){ T[t]=T[t].filter(r=>!match(r,u.searchParams)); out=null; }
  return new Response(out===null?'':JSON.stringify(out),{status:200});
};
const env={ SUPABASE_URL:'https://x.supabase.co', SUPABASE_SERVICE_KEY:'k', ADMIN_PASS:'pw-admin', ASSETS:{fetch:async()=>new Response('<html>ok</html>')}, LIVEKIT_URL:'wss://l', LIVEKIT_API_KEY:'K', LIVEKIT_API_SECRET:'S', STRIPE_WEBHOOK_SECRET:'whsec_t' };
const call=async(p,o={},tok)=>{const h={'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})};const r=await worker.fetch(new Request('https://423.rent'+p,{...o,headers:{...h,...(o.headers||{})}}),env);const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return[r.status,j]};
const post=(p,b,t)=>call(p,{method:'POST',body:JSON.stringify(b)},t);
let ok=true; const chk=(n,c)=>{console.log(c?'PASS':'FAIL',n); if(!c)ok=false;};
chk('static falls through',(await call('/'))[1].includes('ok'));
const [,a]=await post('/api/auth',{email:'a@x.co',password:'secret123',name:'Ann'}); const A=a.token;
const [,b]=await post('/api/auth',{email:'b@x.co',password:'secret123',name:'Bob',role:'renters'}); const B=b.token;
chk('signup tokens',A&&B);
chk('wrong password 401',(await post('/api/auth',{email:'a@x.co',password:'nope'}))[0]===401);
chk('login again',(await post('/api/auth',{email:'a@x.co',password:'secret123'}))[0]===200);
chk('GET /api/auth',(await call('/api/auth',{},A))[1].user.name==='Ann');
chk('create listing',(await post('/api/listings',{listing:{id:'l1',title:'Roll dumper',price:50}},B))[0]===200);
chk('list listings',(await call('/api/listings'))[1].listings[0].ownerId===b.user.id);
chk('other user cannot overwrite',(await post('/api/listings',{listing:{id:'l1',title:'x'}},A))[0]===403);
const [,ag]=await post('/api/agreements',{agrId:'g1',listingId:'l1',title:'Roll dumper',rent:50,fee:5,deposit:20,renterName:'Ann'},A);
chk('agreement total 75 & sent',ag.agreement.total===75&&ag.agreement.status==='Sent to lister');
chk('renter cannot accept',(await post('/api/agreements/g1/accept',{},A))[0]===403);
chk('lister accepts',(await post('/api/agreements/g1/accept',{},B))[1].agreement.status==='Accepted');
chk('demo pay ok (no stripe key)',(await post('/api/agreements/g1/paid',{},A))[1].agreement.status==='Paid');
chk('review',(await post('/api/reviews',{agrId:'g1',rating:5,text:'great'},A))[0]===200);
chk('review list',(await call('/api/reviews?listingId=l1'))[1].reviews.length===1);
chk('message + dedupe',(await post('/api/messages',{to:b.user.id,text:'hi'},A))[0]===200 && (await post('/api/messages',{to:b.user.id,text:'hi'},A))[0]===200 && (await call('/api/messages?with='+a.user.id,{},B))[1].messages.length===1);
chk('conversations',(await call('/api/messages',{},B))[1].conversations[0].unread===0);
chk('scores',(await post('/api/scores',{game:'trivia',level:4},A))[1].best.trivia===4);
chk('profile patch',(await call('/api/users',{method:'PATCH',body:JSON.stringify({bio:'hello',phone:'123'})},A))[1].user.bio==='hello');
chk('livekit token 3 parts',(await post('/api/livekit-token',{with:b.user.id,invite:true},A))[1].token.split('.').length===3);
chk('admin bad',(await post('/api/admin-login',{user:'admin',pass:'x'}))[0]===401);
const [,ad]=await post('/api/admin-login',{user:'admin',pass:'pw-admin'}); chk('admin ok',ad.ok&&ad.token);
chk('admin verify',(await call('/api/admin-verify',{},ad.token))[1].ok===true);
chk('admin can delete listing',(await call('/api/listings?id=l1',{method:'DELETE'},ad.token))[0]===200 && (await call('/api/listings'))[1].listings.length===0);
chk('logout kills session',(await post('/api/logout',{},A))[0]===200 && (await call('/api/auth',{},A))[0]===401);
// stripe webhook signature
const raw=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_TEST123456',payment_status:'paid',amount_total:7500,metadata:{agr_id:'g1'}}}});
const t=Math.floor(Date.now()/1000); const k=await crypto.subtle.importKey('raw',new TextEncoder().encode('whsec_t'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const sig=[...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(t+'.'+raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
chk('webhook bad sig 400',(await call('/api/stripe-webhook',{method:'POST',body:raw,headers:{'stripe-signature':`t=${t},v1=bad`}}))[0]===400);
chk('webhook good sig 200',(await call('/api/stripe-webhook',{method:'POST',body:raw,headers:{'stripe-signature':`t=${t},v1=${sig}`}}))[0]===200);
chk('payment recorded',T.payments&&T.payments[0].receipt_id==='TXN-123456');
console.log(ok?'ALL PASS':'FAILURES'); process.exit(ok?0:1);
