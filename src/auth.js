const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>b64(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const passwordHash=async (password,salt,iterations=310000)=>b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations,hash:'SHA-256'},await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']),256));
const securePassword=p=>typeof p==='string'&&p.length>=14&&p.length<=128;
const validEmail=e=>typeof e==='string'&&e.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const authJson=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
const cookie=(token,maxAge)=>'hmt_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
async function sessionUser(request,env){const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)hmt_session=([^;]+)/)?.[1];if(!token)return null;const hash=await digest(token);return env.DB.prepare("SELECT u.id,u.email,u.display_name,u.country_code,u.account_status,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>datetime('now') AND u.account_status='active'").bind(hash).first();}
async function roles(env,id){const r=await env.DB.prepare('SELECT role FROM user_roles WHERE user_id=?').bind(id).all();return r.results.map(x=>x.role);}
async function allowedCountry(env,user,country){const rr=await roles(env,user.id);if(rr.includes('super_admin')||rr.includes('admin'))return true;if(!rr.includes('country_lead'))return false;return !!(await env.DB.prepare('SELECT 1 FROM country_leads WHERE country_code=? AND user_id=?').bind(country,user.id).first());}
async function issueSession(env,userId){const token=random();await env.DB.prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at) VALUES(?,?,datetime('now','+8 hours'))").bind(await digest(token),userId).run();return token;}
async function authRoute(request,env,url){
 const path=url.pathname,method=request.method;
 if(method==='POST'&&request.headers.get('origin')!==url.origin)return authJson({error:'Invalid request origin'},403);
 if(method==='POST'&&Number(request.headers.get('content-length')||0)>8192)return authJson({error:'Request too large'},413);
 let data={};if(method==='POST'){try{data=await request.json();if(!data||typeof data!=='object')throw Error();}catch{return authJson({error:'Invalid JSON'},400);}}
 if(path==='/api/auth/setup-status'&&method==='GET'){const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role='super_admin'").first();return authJson({setup_required:row.n===0});}
 if(path==='/api/auth/bootstrap'&&method==='POST'){
  const existing=await env.DB.prepare("SELECT 1 FROM user_roles WHERE role='super_admin' LIMIT 1").first();
  if(existing)return authJson({error:'Setup already completed'},403);
  if(!env.ADMIN_SETUP_TOKEN||data.setup_token!==env.ADMIN_SETUP_TOKEN)return authJson({error:'Setup unavailable'},403);
  if(!validEmail(data.email)||!securePassword(data.password)||typeof data.display_name!=='string'||data.display_name.length<2||data.display_name.length>120)return authJson({error:'Invalid account details; password must be 14–128 characters'},400);
  const salt=random(),hash=await passwordHash(data.password,salt),id=crypto.randomUUID();
  await env.DB.batch([env.DB.prepare("INSERT INTO organizations(id,name) VALUES('hmt','HMT') ON CONFLICT(id) DO NOTHING"),env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,account_status,password_salt,password_hash,password_iterations,password_changed_at) VALUES(?,'hmt',?,?,'admin','active',?,?,310000,CURRENT_TIMESTAMP)").bind(id,data.email.toLowerCase(),data.display_name,salt,hash),env.DB.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'super_admin')").bind(id),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id) VALUES(?,?,'bootstrap',?)").bind(crypto.randomUUID(),id,id)]);
  return authJson({ok:true,message:'Administrator created. Sign in to continue.'},201);
 }
 if(path==='/api/auth/login'&&method==='POST'){
  if(!validEmail(data.email)||typeof data.password!=='string')return authJson({error:'Invalid credentials'},401);
  const u=await env.DB.prepare("SELECT id,password_salt,password_hash,password_iterations FROM users WHERE email=? AND account_status='active'").bind(data.email.toLowerCase()).first();
  if(!u||!u.password_salt||!u.password_hash)return authJson({error:'Invalid credentials'},401);
  const hash=await passwordHash(data.password,u.password_salt,u.password_iterations||310000);
  if(hash!==u.password_hash)return authJson({error:'Invalid credentials'},401);
  const token=await issueSession(env,u.id);
  await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type) VALUES(?,?,'login')").bind(crypto.randomUUID(),u.id).run();
  return authJson({ok:true},200,{'set-cookie':cookie(token,28800)});
 }
 const user=await sessionUser(request,env);
 if(path==='/api/auth/me'&&method==='GET')return user?authJson({user:{id:user.id,email:user.email,display_name:user.display_name,country_code:user.country_code,roles:await roles(env,user.id)}}):authJson({error:'Authentication required'},401);
 if(path==='/api/auth/logout'&&method==='POST'){
  const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)hmt_session=([^;]+)/)?.[1];
  if(token)await env.DB.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id_hash=?").bind(await digest(token)).run();
  return authJson({ok:true},200,{'set-cookie':cookie('',0)});
 }
 if(!user)return authJson({error:'Authentication required'},401);
 const r=await roles(env,user.id),admin=r.includes('admin')||r.includes('super_admin');
 if(path==='/api/admin/users'&&method==='GET'){
  if(!admin)return authJson({error:'Forbidden'},403);
  const users=await env.DB.prepare("SELECT id,email,display_name,country_code,account_status,created_at FROM users ORDER BY created_at DESC LIMIT 100").all();
  return authJson({users:users.results});
 }
 if(path==='/api/admin/users'&&method==='POST'){
  if(!admin)return authJson({error:'Forbidden'},403);
  if(!validEmail(data.email)||!securePassword(data.password)||typeof data.display_name!=='string'||data.display_name.length<2||!['MU','MG','RW','BI'].includes(data.country_code)||!['admin','country_lead','regional_manager','group_leader','technician','requester'].includes(data.role))return authJson({error:'Invalid account details'},400);
  const id=crypto.randomUUID(),salt=random(),hash=await passwordHash(data.password,salt);
  try{await env.DB.batch([env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,country_code,account_status,password_salt,password_hash,password_iterations,password_changed_at) VALUES(?,'hmt',?,?, 'requester',?,'active',?,?,310000,CURRENT_TIMESTAMP)").bind(id,data.email.toLowerCase(),data.display_name,data.country_code,salt,hash),env.DB.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').bind(id,data.role),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'user_created',?,?)").bind(crypto.randomUUID(),user.id,id,data.country_code)]);}catch{return authJson({error:'Account could not be created (possibly duplicate email)'},409);}
  return authJson({id,created:true},201);
 }
 if(path==='/api/admin/country-leads'&&method==='POST'){
  if(!admin)return authJson({error:'Forbidden'},403);
  if(!['MU','MG','RW','BI'].includes(data.country_code)||typeof data.user_id!=='string')return authJson({error:'Invalid assignment'},400);
  const target=await env.DB.prepare("SELECT id FROM users WHERE id=? AND account_status='active'").bind(data.user_id).first();
  if(!target)return authJson({error:'Active user not found'},404);
  await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO user_roles(user_id,role) VALUES(?,?)').bind(data.user_id,'country_lead'),env.DB.prepare('INSERT OR IGNORE INTO country_leads(country_code,user_id) VALUES(?,?)').bind(data.country_code,data.user_id)]);
  return authJson({assigned:true});
 }
 if(path==='/api/admin/registrations'&&method==='GET'){
  if(!admin&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT id,email,display_name,country_code,organization_name,status,created_at FROM registration_requests WHERE status='pending_approval' ORDER BY created_at DESC LIMIT 100").all();
  const visible=[];for(const item of rows.results){if(await allowedCountry(env,user,item.country_code))visible.push(item);}
  return authJson({registrations:visible});
 }
 if(path==='/api/admin/registrations/review'&&method==='POST'){
  if(!['approve','reject'].includes(data.decision)||typeof data.id!=='string')return authJson({error:'Invalid decision'},400);
  const item=await env.DB.prepare("SELECT * FROM registration_requests WHERE id=? AND status='pending_approval'").bind(data.id).first();
  if(!item)return authJson({error:'Pending request not found'},404);
  if(!await allowedCountry(env,user,item.country_code))return authJson({error:'Forbidden'},403);
  if(data.decision==='approve')return authJson({error:'Account activation delivery must be configured before approval can create an account'},503);
  await env.DB.prepare("UPDATE registration_requests SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_approval'").bind(user.id,item.id).run();
  await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'registration_rejected',?,?)").bind(crypto.randomUUID(),user.id,item.id,item.country_code).run();
  return authJson({ok:true});
 }
 return authJson({error:'Not found'},404);
}
