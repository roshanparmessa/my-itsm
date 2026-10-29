const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>b64(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const passwordHash=async (password,salt,iterations=100000)=>b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations,hash:'SHA-256'},await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']),256));
const securePassword=p=>typeof p==='string'&&p.length>=14&&p.length<=128;
const validEmail=e=>typeof e==='string'&&e.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const authJson=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
const cookie=(token,maxAge)=>'hmt_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
async function sessionUser(request,env){const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)hmt_session=([^;]+)/)?.[1];if(!token)return null;const hash=await digest(token);return env.DB.prepare("SELECT u.id,u.email,u.display_name,u.country_code,u.account_status,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>datetime('now') AND u.account_status='active'").bind(hash).first();}
async function roles(env,id){const r=await env.DB.prepare('SELECT role FROM user_roles WHERE user_id=?').bind(id).all();return r.results.map(x=>x.role);}
async function allowedCountry(env,user,country){const rr=await roles(env,user.id);if(rr.includes('super_admin')||rr.includes('admin'))return true;if(!rr.includes('country_lead'))return false;return !!(await env.DB.prepare('SELECT 1 FROM country_leads WHERE country_code=? AND user_id=?').bind(country,user.id).first());}
async function issueSession(env,userId){const token=random();await env.DB.prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at) VALUES(?,?,datetime('now','+8 hours'))").bind(await digest(token),userId).run();return token;}
async function loginFailed(env,key){await env.DB.prepare("INSERT INTO login_limits(id,attempts,blocked_until) VALUES(?,1,NULL) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN blocked_until IS NOT NULL AND blocked_until<datetime('now') THEN 1 ELSE attempts+1 END,blocked_until=CASE WHEN attempts>=4 THEN datetime('now','+15 minutes') ELSE NULL END").bind(key).run();}
export { sessionUser, roles };
export async function authRoute(request,env,url){
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
  let salt,hash;try{salt=random();hash=await passwordHash(data.password,salt);}catch(e){console.error('bootstrap password hashing failed',e);return authJson({error:'Administrator setup failed during password protection',code:'BOOTSTRAP_HASH'},500);}const id=crypto.randomUUID();
  try{await env.DB.batch([env.DB.prepare("INSERT INTO organizations(id,name) VALUES('hmt','HMT') ON CONFLICT(id) DO NOTHING"),env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,account_status,password_salt,password_hash,password_iterations,password_changed_at) VALUES(?,'hmt',?,?,'admin','active',?,?,100000,CURRENT_TIMESTAMP)").bind(id,data.email.toLowerCase(),data.display_name,salt,hash),env.DB.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'super_admin')").bind(id),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id) VALUES(?,?,'bootstrap',?)").bind(crypto.randomUUID(),id,id)]);}catch(e){console.error('bootstrap database transaction failed',e);return authJson({error:'Administrator setup failed while saving the account',code:'BOOTSTRAP_DATABASE'},500);}
  return authJson({ok:true,message:'Administrator created. Sign in to continue.'},201);
 }
 if(path==='/api/auth/register'&&method==='POST'){
  const email=String(data.email||'').trim().toLowerCase();
  if(email!=='roshan.parmessa@gmail.com')return authJson({error:'Pilot registration is restricted to the verified Resend test inbox until a sending domain is configured.'},403);
  if(typeof data.display_name!=='string'||data.display_name.trim().length<2||data.display_name.length>120||!['MU','MG','RW','BI'].includes(data.country_code)||typeof data.organization_name!=='string'||data.organization_name.length>120)return authJson({error:'Invalid registration details'},400);
  const existing=await env.DB.prepare("SELECT 1 FROM users WHERE email=?").bind(email).first();
  if(existing)return authJson({error:'An account already exists'},409);
  const {sendTestEmail}=await import('./email.js');
  const token=random(),id=crypto.randomUUID(),tokenHash=await digest(token);
  try{await env.DB.prepare("INSERT INTO registration_requests(id,email,display_name,country_code,organization_name,status,verification_hash,verification_expires_at) VALUES(?,?,?,?,?,'pending_verification',?,datetime('now','+30 minutes'))").bind(id,email,data.display_name.trim(),data.country_code,data.organization_name.trim(),tokenHash).run();}catch{return authJson({error:'A registration is already pending for this address'},409);}
  const verifyUrl=url.origin+'/api/auth/verify-registration?token='+encodeURIComponent(token);
  const mail=await sendTestEmail(env,{subject:'HMT Collabs — verify pilot registration',text:'Confirm your registration by opening this link within 30 minutes:\\n'+verifyUrl+'\\nIf you did not request this, ignore this email.'});
  if(!mail.ok){await env.DB.prepare("DELETE FROM registration_requests WHERE id=? AND status='pending_verification'").bind(id).run();return authJson({error:'Verification email could not be sent',provider_status:mail.status||null},502);}
  return authJson({ok:true,message:'Check your test inbox for a verification link. Your request will then await Country Lead approval.'},202);
 }
 if(path==='/api/auth/verify-registration'&&method==='GET'){
  const token=url.searchParams.get('token');
  if(!token||token.length>256)return authJson({error:'Invalid verification link'},400);
  const hashed=await digest(token);
  const row=await env.DB.prepare("SELECT id FROM registration_requests WHERE verification_hash=? AND status='pending_verification' AND verification_expires_at>datetime('now')").bind(hashed).first();
  if(!row)return authJson({error:'Verification link expired or already used'},400);
  await env.DB.prepare("UPDATE registration_requests SET status='pending_approval',verification_hash=NULL,verification_expires_at=NULL WHERE id=? AND status='pending_verification'").bind(row.id).run();
  const requestInfo=await env.DB.prepare('SELECT display_name,country_code,organization_name FROM registration_requests WHERE id=?').bind(row.id).first();
  const {sendTestEmail}=await import('./email.js');
  await sendTestEmail(env,{subject:'HMT Collabs — registration awaiting approval',text:'A verified registration is awaiting review.\nName: '+requestInfo.display_name+'\nCountry: '+requestInfo.country_code+'\nOrganization: '+requestInfo.organization_name+'\nThis email is a notification only. To approve or reject, sign in to HMT Collabs and open Registration Approvals: '+url.origin+'/approvals'}).catch(e=>console.error('Approval notification failed',e));
  return new Response('<!doctype html><html><meta charset="utf-8"><title>HMT Collabs</title><body><h1>Email verified</h1><p>Your registration is pending Country Lead approval. Your account is not active.</p><a href="/">Return to HMT Collabs</a></body></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'none'"}});
 }
 if(path==='/api/auth/login'&&method==='POST'){
  if(!validEmail(data.email)||typeof data.password!=='string')return authJson({error:'Invalid credentials'},401);
  const key=await digest(data.email.toLowerCase()+'|'+(request.headers.get('cf-connecting-ip')||'unknown'));const attempts=await env.DB.prepare("SELECT attempts,blocked_until FROM login_limits WHERE id=?").bind(key).first();if(attempts?.blocked_until&&Date.parse(attempts.blocked_until+'Z')>Date.now())return authJson({error:'Too many attempts. Try again later.'},429);
  const u=await env.DB.prepare("SELECT id,password_salt,password_hash,password_iterations FROM users WHERE email=? AND account_status='active'").bind(data.email.toLowerCase()).first();
  if(!u||!u.password_salt||!u.password_hash){await loginFailed(env,key);return authJson({error:'Invalid credentials'},401);}
  const hash=await passwordHash(data.password,u.password_salt,u.password_iterations||310000);
  if(hash!==u.password_hash){await loginFailed(env,key);return authJson({error:'Invalid credentials'},401);}await env.DB.prepare('DELETE FROM login_limits WHERE id=?').bind(key).run();
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
  try{await env.DB.batch([env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,country_code,account_status,password_salt,password_hash,password_iterations,password_changed_at) VALUES(?,'hmt',?,?, 'requester',?,'inactive',?,?,100000,CURRENT_TIMESTAMP)").bind(id,data.email.toLowerCase(),data.display_name,data.country_code,salt,hash),env.DB.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').bind(id,data.role),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'user_created',?,?)").bind(crypto.randomUUID(),user.id,id,data.country_code)]);}catch{return authJson({error:'Account could not be created (possibly duplicate email)'},409);}
  return authJson({id,created:true,account_status:'inactive',activation_required:true},201);
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
  const rows=await env.DB.prepare("SELECT id,email,display_name,country_code,organization_name,status,created_at,verification_expires_at FROM registration_requests WHERE status IN ('pending_verification','pending_approval') ORDER BY created_at DESC LIMIT 100").all();
  const visible=[];for(const item of rows.results){if(await allowedCountry(env,user,item.country_code))visible.push(item);}
  return authJson({registrations:visible});
 }
 if(path==='/api/admin/registrations/review'&&method==='POST'){
  if(!['approve','reject'].includes(data.decision)||typeof data.id!=='string')return authJson({error:'Invalid decision'},400);
  const item=await env.DB.prepare("SELECT * FROM registration_requests WHERE id=? AND status='pending_approval'").bind(data.id).first();
  if(!item)return authJson({error:'Pending request not found'},404);
  if(!await allowedCountry(env,user,item.country_code))return authJson({error:'Forbidden'},403);
  if(data.decision==='approve'){
   const result=await env.DB.prepare("UPDATE registration_requests SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_approval'").bind(user.id,item.id).run();
   if(!result.meta.changes)return authJson({error:'Request was already reviewed'},409);
   await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code,details) VALUES(?,?,'registration_approved',?,?,?)").bind(crypto.randomUUID(),user.id,item.id,item.country_code,'Approval recorded; account activation pending').run();
   return authJson({ok:true,status:'approved',activation_pending:true,message:'Registration approved. Account activation is not yet configured.'});
  }
  await env.DB.prepare("UPDATE registration_requests SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_approval'").bind(user.id,item.id).run();
  await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'registration_rejected',?,?)").bind(crypto.randomUUID(),user.id,item.id,item.country_code).run();
  return authJson({ok:true});
 }
 return authJson({error:'Not found'},404);
}
