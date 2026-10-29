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
  const mail=await sendTestEmail(env,{subject:'HMT Collabs — verify pilot registration',text:'Confirm your registration by opening this link within 30 minutes:\n'+verifyUrl+'\nIf you did not request this, ignore this email.'});
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
  const leads=await env.DB.prepare("SELECT DISTINCT u.email FROM country_leads cl JOIN users u ON u.id=cl.user_id JOIN user_roles ur ON ur.user_id=u.id AND ur.role='country_lead' WHERE cl.country_code=? AND u.account_status='active'").bind(requestInfo.country_code).all();
  const leadEmails=leads.results.map(x=>x.email);
  if(leadEmails.length===0)console.warn('Registration has no active Country Lead assigned',requestInfo.country_code);
  await sendTestEmail(env,{subject:'HMT Collabs — registration awaiting approval',text:'A verified registration is awaiting review.\nName: '+requestInfo.display_name+'\nCountry: '+requestInfo.country_code+'\nOrganization: '+requestInfo.organization_name+'\nAssigned Country Lead(s): '+(leadEmails.join(', ')||'None — assign an active Country Lead in Administration')+'\nThis email is a notification only. To approve or reject, sign in to HMT Collabs and open Registration Approvals: '+url.origin+'/approvals'}).catch(e=>console.error('Approval notification failed',e));
  return new Response('<!doctype html><html><meta charset="utf-8"><title>HMT Collabs</title><body><h1>Email verified</h1><p>Your registration is pending Country Lead approval. Your account is not active.</p><a href="/">Return to HMT Collabs</a></body></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'none'"}});
 }
 if(path==='/api/auth/activate'&&method==='POST'){
  const token=String(data.token||'');
  if(token.length<20||token.length>256||!securePassword(data.password))return authJson({error:'Invalid activation details; password must be 14–128 characters'},400);
  const tokenHash=await digest(token);
  const pending=await env.DB.prepare("SELECT a.request_id,a.user_id FROM registration_activation_tokens a JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND a.consumed_at IS NULL AND a.expires_at>datetime('now') AND u.account_status='inactive'").bind(tokenHash).first();
  if(!pending)return authJson({error:'Activation link expired, already used or invalid'},400);
  const salt=random(),hash=await passwordHash(data.password,salt);
  const updated=await env.DB.prepare("UPDATE registration_activation_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE request_id=? AND consumed_at IS NULL AND expires_at>datetime('now')").bind(pending.request_id).run();
  if(!updated.meta.changes)return authJson({error:'Activation link already used'},409);
  await env.DB.prepare("UPDATE users SET password_salt=?,password_hash=?,password_iterations=100000,password_changed_at=CURRENT_TIMESTAMP,account_status='active' WHERE id=? AND account_status='inactive'").bind(salt,hash,pending.user_id).run();
  await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id) VALUES(?,?,'customer_activated',?)").bind(crypto.randomUUID(),pending.user_id,pending.user_id).run();
  return authJson({ok:true,message:'Account activated. Sign in with your email and password.'});
 }
 if(path==='/api/auth/complete-reset'&&method==='POST'){
  const token=String(data.token||'');
  if(token.length<20||token.length>256||!securePassword(data.password))return authJson({error:'Invalid reset token or password (14–128 characters required)'},400);
  const hash=await digest(token);
  const entry=await env.DB.prepare("SELECT pr.user_id FROM account_password_resets pr JOIN users u ON u.id=pr.user_id LEFT JOIN account_deletions d ON d.user_id=u.id WHERE pr.token_hash=? AND pr.consumed_at IS NULL AND pr.expires_at>datetime('now') AND u.account_status='active' AND d.user_id IS NULL").bind(hash).first();
  if(!entry)return authJson({error:'Reset link expired or invalid'},400);
  const salt=random(),password=await passwordHash(data.password,salt);
  const result=await env.DB.prepare("UPDATE account_password_resets SET consumed_at=CURRENT_TIMESTAMP WHERE user_id=? AND token_hash=? AND consumed_at IS NULL").bind(entry.user_id,hash).run();
  if(!result.meta.changes)return authJson({error:'Reset link already used'},409);
  await env.DB.batch([
   env.DB.prepare("UPDATE users SET password_salt=?,password_hash=?,password_iterations=100000,password_changed_at=CURRENT_TIMESTAMP WHERE id=?").bind(salt,password,entry.user_id),
   env.DB.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL").bind(entry.user_id),
   env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id) VALUES(?,?,'password_reset_completed',?)").bind(crypto.randomUUID(),entry.user_id,entry.user_id)
  ]);
  return authJson({ok:true,message:'Password updated. Please sign in.'});
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
 if(path==='/api/admin/customer-users'&&method==='GET'){
  if(!admin&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const customers=await env.DB.prepare("SELECT id,name,country_code FROM customers WHERE organization_id='hmt' ORDER BY name LIMIT 500").all();
  const visible=[];for(const c of customers.results)if(await allowedCountry(env,user,c.country_code))visible.push(c);
  const access=await env.DB.prepare("SELECT a.user_id,a.customer_id,u.email,u.display_name,u.account_status,c.name AS customer_name,c.country_code FROM customer_user_access a JOIN users u ON u.id=a.user_id JOIN customers c ON c.id=a.customer_id WHERE c.organization_id='hmt' ORDER BY c.name,u.display_name LIMIT 500").all();
  const mappings=[];for(const a of access.results)if(await allowedCountry(env,user,a.country_code))mappings.push(a);
  return authJson({customers:visible,mappings});
 }
 if(path==='/api/admin/customer-users'&&method==='POST'){
  if(!admin&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const action=String(data.action||''),id=String(data.user_id||''),customerId=String(data.customer_id||'');
  if(!['assign','revoke'].includes(action)||!id||!customerId)return authJson({error:'Invalid customer access request'},400);
  const target=await env.DB.prepare("SELECT id,country_code,account_status FROM users WHERE id=? AND organization_id='hmt'").bind(id).first();
  const customer=await env.DB.prepare("SELECT id,country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(customerId).first();
  if(!target||!customer||!await allowedCountry(env,user,customer.country_code)||!await allowedCountry(env,user,target.country_code))return authJson({error:'Forbidden'},403);
  const targetRoles=await roles(env,id);
  if(targetRoles.some(role=>role!=='requester'))return authJson({error:'Only requester-only accounts may be linked to customers'},409);
  if(action==='assign'){
   if(target.country_code!==customer.country_code)return authJson({error:'User and customer countries must match'},400);
   await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO customer_user_access(user_id,customer_id,created_by) VALUES(?,?,?)").bind(id,customerId,user.id),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code,details) VALUES(?,?,'customer_access_assigned',?,?,?)").bind(crypto.randomUUID(),user.id,id,customer.country_code,customerId)]);
  }else{
   await env.DB.batch([env.DB.prepare("DELETE FROM customer_user_access WHERE user_id=? AND customer_id=?").bind(id,customerId),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code,details) VALUES(?,?,'customer_access_revoked',?,?,?)").bind(crypto.randomUUID(),user.id,id,customer.country_code,customerId)]);
   await env.DB.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL").bind(id).run();
  }
  return authJson({ok:true});
 }
 const customerOnly=r.length===1&&r[0]==='requester';
 if(r.includes('requester')&&!customerOnly&&!admin)return authJson({error:'Conflicting customer and internal roles'},403);
 if(customerOnly&&path.startsWith('/api/')&&!path.startsWith('/api/auth/')){
  const permitted=new Set(['/api/customer-portal/overview','/api/customer-portal/tickets']);
  if(!permitted.has(path)||method!=='GET')return authJson({error:'Customer portal users cannot access internal APIs'},403);
 }
 if(path==='/api/customer-portal/overview'&&method==='GET'){
  if(!customerOnly)return authJson({error:'Customer portal account required'},403);
  const rows=await env.DB.prepare("SELECT c.id,c.name,c.country_code FROM customer_user_access a JOIN customers c ON c.id=a.customer_id WHERE a.user_id=? AND c.organization_id='hmt' ORDER BY c.name LIMIT 100").bind(user.id).all();
  return authJson({customers:rows.results});
 }
 if(path==='/api/customer-portal/tickets'&&method==='GET'){
  if(!customerOnly)return authJson({error:'Customer portal account required'},403);
  const id=url.searchParams.get('customer_id')||'';
  const granted=await env.DB.prepare("SELECT 1 FROM customer_user_access a JOIN customers c ON c.id=a.customer_id WHERE a.user_id=? AND a.customer_id=? AND c.organization_id='hmt'").bind(user.id,id).first();
  if(!granted)return authJson({error:'Customer access denied'},403);
  const rows=await env.DB.prepare("SELECT id,title,description,priority,status,created_at,response_due_at,resolution_due_at FROM service_tickets WHERE customer_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all();
  return authJson({tickets:rows.results});
 }
 if(path==='/api/auth/customer-scope'&&method==='GET'){
  if(!r.includes('requester')||r.some(role=>role!=='requester'))return authJson({error:'Customer access only'},403);
  const rows=await env.DB.prepare("SELECT c.id,c.name,c.country_code FROM customer_user_access a JOIN customers c ON c.id=a.customer_id WHERE a.user_id=? AND c.organization_id='hmt' ORDER BY c.name").bind(user.id).all();
  return authJson({customers:rows.results});
 }
 if(path==='/api/customers'&&method==='GET'){
  if(!r.some(x=>['super_admin','admin','country_lead','regional_manager','group_leader','technician'].includes(x)))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT c.id,c.name,c.country_code,c.created_at,p.industry,p.website,p.phone,p.address,p.status,p.notes FROM customers c LEFT JOIN customer_profiles p ON p.customer_id=c.id WHERE c.organization_id='hmt' ORDER BY c.name LIMIT 300").all();
  const visible=[];for(const item of rows.results){if(await allowedCountry(env,user,item.country_code))visible.push(item);}
  return authJson({customers:visible});
 }
 if(path==='/api/customers'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const name=String(data.name||'').trim(),country=String(data.country_code||'');
  if(name.length<2||name.length>150||!['MU','MG','RW','BI'].includes(country)||!await allowedCountry(env,user,country))return authJson({error:'Invalid customer or country permissions'},400);
  const id=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO customers(id,organization_id,name,country_code) VALUES(?,'hmt',?,?)").bind(id,name,country),
   env.DB.prepare("INSERT INTO customer_profiles(customer_id,industry,website,phone,address,notes) VALUES(?,?,?,?,?,?)").bind(id,String(data.industry||'').slice(0,120),String(data.website||'').slice(0,250),String(data.phone||'').slice(0,80),String(data.address||'').slice(0,400),String(data.notes||'').slice(0,1000)),
   env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'customer_created',?,?)").bind(crypto.randomUUID(),user.id,id,country)
  ]);
  return authJson({ok:true,id},201);
 }
 if(path==='/api/admin/pipeline-overview'&&method==='GET'){
  if(!r.some(x=>['super_admin','admin','country_lead'].includes(x)))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT p.id,p.kind,p.title,p.stage,p.value_amount,p.currency,p.probability,p.due_date,c.name AS customer,c.country_code FROM commercial_records p JOIN customers c ON c.id=p.customer_id WHERE c.organization_id='hmt' ORDER BY p.updated_at DESC LIMIT 500").all();
  const visible=[];for(const item of rows.results)if(await allowedCountry(env,user,item.country_code))visible.push(item);
  const summary={total:visible.length,open:visible.filter(x=>!['won','lost','completed'].includes(x.stage)).length,overdue:visible.filter(x=>x.due_date&&x.due_date<new Date().toISOString().slice(0,10)&&!['won','lost','completed'].includes(x.stage)).length};
  return authJson({summary,records:visible});
 }
 if(path==='/api/customers/pipeline'&&method==='GET'){
  const id=url.searchParams.get('customer_id')||'';
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT p.id,p.kind,p.title,p.reference,p.stage,p.value_amount,p.currency,p.probability,p.due_date,p.notes,p.owner_id,u.display_name AS owner FROM commercial_records p LEFT JOIN users u ON u.id=p.owner_id WHERE p.customer_id=? ORDER BY p.updated_at DESC LIMIT 250").bind(id).all();
  return authJson({records:rows.results});
 }
 if(path==='/api/customers/pipeline'&&method==='POST'){
  if(!r.some(x=>['super_admin','admin','country_lead'].includes(x)))return authJson({error:'Forbidden'},403);
  const customerId=String(data.customer_id||''),kind=String(data.kind||''),title=String(data.title||'').trim(),currency=String(data.currency||'MUR').toUpperCase(),amount=Number(data.value_amount||0),probability=Number(data.probability||0),due=String(data.due_date||'');
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(customerId).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  if(!['rfp','quotation','poc','prospection','opportunity','contract','project'].includes(kind)||title.length<3||title.length>180||!Number.isFinite(amount)||amount<0||amount>100000000000||!Number.isInteger(probability)||probability<0||probability>100||!['MUR','EUR','USD','MGA','RWF','BIF'].includes(currency)||due&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(due))return authJson({error:'Invalid commercial record'},400);
  const id=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO commercial_records(id,customer_id,kind,title,reference,value_amount,currency,probability,due_date,notes,owner_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,customerId,kind,title,String(data.reference||'').slice(0,80),amount,currency,probability,due||null,String(data.notes||'').slice(0,2000),user.id,user.id),
   env.DB.prepare("INSERT INTO commercial_events(id,record_id,actor_id,event_type) VALUES(?,?,?,'created')").bind(crypto.randomUUID(),id,user.id)
  ]);
  return authJson({ok:true,id},201);
 }
 if(path==='/api/customers/pipeline/update'&&method==='POST'){
  if(!r.some(x=>['super_admin','admin','country_lead'].includes(x)))return authJson({error:'Forbidden'},403);
  const record=await env.DB.prepare("SELECT p.id,p.stage,c.country_code FROM commercial_records p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.organization_id='hmt'").bind(String(data.id||'')).first();
  if(!record||!await allowedCountry(env,user,record.country_code))return authJson({error:'Forbidden'},403);
  const stage=String(data.stage||'');
  if(!['new','qualifying','preparing','submitted','negotiation','won','lost','on_hold','in_progress','completed'].includes(stage))return authJson({error:'Invalid stage'},400);
  await env.DB.batch([
   env.DB.prepare("UPDATE commercial_records SET stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(stage,record.id),
   env.DB.prepare("INSERT INTO commercial_events(id,record_id,actor_id,event_type,detail) VALUES(?,?,?,'stage_changed',?)").bind(crypto.randomUUID(),record.id,user.id,record.stage+' -> '+stage)
  ]);
  return authJson({ok:true});
 }
 if(path==='/api/customers/tickets'&&method==='GET'){
  const id=url.searchParams.get('customer_id')||'';
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT t.id,t.title,t.description,t.priority,t.status,t.created_at,t.response_due_at,t.resolution_due_at,u.display_name AS assignee FROM service_tickets t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.customer_id=? ORDER BY t.created_at DESC LIMIT 200").bind(id).all();
  return authJson({tickets:rows.results});
 }
 if(path==='/api/customers/tickets'&&method==='POST'){
  if(!r.some(x=>['super_admin','admin','country_lead'].includes(x)))return authJson({error:'Forbidden'},403);
  const id=String(data.customer_id||''),title=String(data.title||'').trim(),description=String(data.description||'').trim(),priority=String(data.priority||'medium');
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  if(title.length<3||title.length>180||description.length>5000||!['low','medium','high','critical'].includes(priority))return authJson({error:'Invalid ticket'},400);
  const hours={critical:[1,4],high:[4,24],medium:[8,72],low:[24,120]}[priority],ticketId=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO service_tickets(id,customer_id,title,description,priority,created_by,response_due_at,resolution_due_at) VALUES(?,?,?,?,?,?,datetime('now',?),datetime('now',?))").bind(ticketId,id,title,description,priority,user.id,'+'+hours[0]+' hours','+'+hours[1]+' hours'),
   env.DB.prepare("INSERT INTO ticket_events(id,ticket_id,actor_id,event_type) VALUES(?,?,?,'created')").bind(crypto.randomUUID(),ticketId,user.id)
  ]);
  return authJson({ok:true,id:ticketId},201);
 }
 if(path==='/api/customers/tickets/update'&&method==='POST'){
  if(!r.some(x=>['super_admin','admin','country_lead'].includes(x)))return authJson({error:'Forbidden'},403);
  const t=await env.DB.prepare("SELECT t.id,t.status,c.country_code FROM service_tickets t JOIN customers c ON c.id=t.customer_id WHERE t.id=? AND c.organization_id='hmt'").bind(String(data.id||'')).first();
  if(!t||!await allowedCountry(env,user,t.country_code))return authJson({error:'Forbidden'},403);
  const status=String(data.status||'');
  if(!['open','in_progress','on_hold','resolved','closed'].includes(status))return authJson({error:'Invalid status'},400);
  await env.DB.batch([
   env.DB.prepare("UPDATE service_tickets SET status=?,updated_at=CURRENT_TIMESTAMP,first_response_at=CASE WHEN first_response_at IS NULL AND ?='in_progress' THEN CURRENT_TIMESTAMP ELSE first_response_at END,resolved_at=CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at,CURRENT_TIMESTAMP) ELSE resolved_at END WHERE id=?").bind(status,status,status,t.id),
   env.DB.prepare("INSERT INTO ticket_events(id,ticket_id,actor_id,event_type,note) VALUES(?,?,?,'status_changed',?)").bind(crypto.randomUUID(),t.id,user.id,t.status+' -> '+status)
  ]);
  return authJson({ok:true});
 }
 if(path==='/api/customers/tasks'&&method==='GET'){
  const customerId=url.searchParams.get('customer_id')||'';
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(customerId).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const tasks=await env.DB.prepare("SELECT t.id,t.customer_id,t.activity_id,t.title,t.description,t.priority,t.status,t.due_date,t.assignee_id,t.created_at,u.display_name AS assignee FROM work_tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.customer_id=? ORDER BY CASE WHEN t.status='done' THEN 1 ELSE 0 END,t.due_date ASC,t.created_at DESC LIMIT 300").bind(customerId).all();
  return authJson({tasks:tasks.results});
 }
 if(path==='/api/customers/tasks'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const customerId=String(data.customer_id||''),customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(customerId).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const title=String(data.title||'').trim(),priority=String(data.priority||'medium'),due=String(data.due_date||'');
  if(title.length<3||title.length>180||!['low','medium','high','critical'].includes(priority)||due&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(due))return authJson({error:'Invalid task'},400);
  const activityId=String(data.activity_id||'').trim()||null;
  if(activityId&&!await env.DB.prepare("SELECT 1 FROM customer_activities WHERE id=? AND customer_id=?").bind(activityId,customerId).first())return authJson({error:'Activity mismatch'},400);
  const assignee=String(data.assignee_id||'').trim()||null;
  if(assignee){const a=await env.DB.prepare("SELECT country_code FROM users WHERE id=? AND account_status='active'").bind(assignee).first();if(!a||a.country_code!==customer.country_code&&!r.includes('super_admin'))return authJson({error:'Invalid assignee'},400);}
  const id=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO work_tasks(id,customer_id,activity_id,title,description,assignee_id,created_by,priority,due_date) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,customerId,activityId,title,String(data.description||'').slice(0,2000),assignee,user.id,priority,due||null),
   env.DB.prepare("INSERT INTO task_events(id,task_id,actor_id,event) VALUES(?,?,?,'created')").bind(crypto.randomUUID(),id,user.id)
  ]);
  return authJson({ok:true,id},201);
 }
 if(path==='/api/customers/tasks/update'&&method==='POST'){
  const id=String(data.id||''),task=await env.DB.prepare("SELECT t.*,c.country_code FROM work_tasks t JOIN customers c ON c.id=t.customer_id WHERE t.id=? AND c.organization_id='hmt'").bind(id).first();
  if(!task||!await allowedCountry(env,user,task.country_code))return authJson({error:'Forbidden'},403);
  if(!r.includes('super_admin')&&!r.includes('country_lead')&&task.assignee_id!==user.id)return authJson({error:'Forbidden'},403);
  const status=String(data.status||'');
  if(!['todo','in_progress','blocked','review','done','cancelled'].includes(status))return authJson({error:'Invalid status'},400);
  await env.DB.batch([
   env.DB.prepare("UPDATE work_tasks SET status=?,completed_at=CASE WHEN ?='done' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,status,id),
   env.DB.prepare("INSERT INTO task_events(id,task_id,actor_id,event,details) VALUES(?,?,?,'status_changed',?)").bind(crypto.randomUUID(),id,user.id,status)
  ]);
  return authJson({ok:true});
 }
 if(path==='/api/admin/workflow-alerts'&&method==='GET'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT id,rule,entity_id,country_code,message,severity,status,created_at FROM workflow_alerts ORDER BY created_at DESC LIMIT 300").all();
  const alerts=[];for(const item of rows.results)if(await allowedCountry(env,user,item.country_code))alerts.push(item);
  return authJson({alerts});
 }
 if(path==='/api/admin/workflow-alerts/scan'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT t.id,t.title,t.priority,t.due_date,t.assignee_id,c.country_code FROM work_tasks t JOIN customers c ON c.id=t.customer_id WHERE c.organization_id='hmt' AND t.status NOT IN ('done','cancelled') LIMIT 500").all();
  let added=0;
  for(const t of rows.results){
   if(!await allowedCountry(env,user,t.country_code))continue;
   const rules=[];
   if(!t.assignee_id)rules.push(['unassigned_task','medium','Task has no owner: '+t.title]);
   if(t.due_date&&t.due_date<new Date().toISOString().slice(0,10))rules.push(['overdue_task',t.priority==='critical'?'critical':'high','Task is overdue: '+t.title]);
   for(const [rule,severity,message] of rules){const result=await env.DB.prepare("INSERT OR IGNORE INTO workflow_alerts(id,rule,entity_type,entity_id,country_code,message,severity) VALUES(?,?,'task',?,?,?,?)").bind(crypto.randomUUID(),rule,t.id,t.country_code,message,severity).run();added+=result.meta?.changes||0;}
  }
  return authJson({ok:true,created:added,scanned:rows.results.length});
 }
 if(path==='/api/admin/workflow-alerts/acknowledge'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const alert=await env.DB.prepare("SELECT country_code FROM workflow_alerts WHERE id=?").bind(String(data.id||'')).first();
  if(!alert||!await allowedCountry(env,user,alert.country_code))return authJson({error:'Forbidden'},403);
  await env.DB.prepare("UPDATE workflow_alerts SET status='acknowledged',acknowledged_by=?,acknowledged_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id,data.id).run();
  return authJson({ok:true});
 }
 if(path==='/api/admin/notifications'&&method==='GET'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT n.id,n.status,n.created_at,a.message,a.severity,a.country_code,u.display_name AS recipient FROM notification_outbox n JOIN workflow_alerts a ON a.id=n.alert_id JOIN users u ON u.id=n.recipient_id ORDER BY n.created_at DESC LIMIT 300").all();
  const notifications=[];for(const row of rows.results)if(await allowedCountry(env,user,row.country_code))notifications.push(row);
  return authJson({notifications});
 }
 if(path==='/api/admin/work-intelligence'&&method==='GET'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT t.id,t.title,t.status,t.priority,t.due_date,c.name AS customer,c.country_code,u.display_name AS assignee,CAST(julianday('now')-julianday(t.due_date) AS INTEGER) AS overdue_days FROM work_tasks t JOIN customers c ON c.id=t.customer_id LEFT JOIN users u ON u.id=t.assignee_id WHERE t.status NOT IN ('done','cancelled') ORDER BY t.due_date ASC LIMIT 500").all();
  const tasks=[];for(const x of rows.results){if(await allowedCountry(env,user,x.country_code))tasks.push(x);}
  const overdue=tasks.filter(x=>x.due_date&&x.overdue_days>0);
  const urgent=tasks.filter(x=>x.priority==='critical'||x.priority==='high');
  const unassigned=tasks.filter(x=>!x.assignee);
  const risks=tasks.filter(x=>(x.overdue_days>0&&x.priority==='critical')||(x.overdue_days>7&&x.priority==='high'));
  return authJson({metrics:{open:tasks.length,overdue:overdue.length,urgent:urgent.length,unassigned:unassigned.length,at_risk:risks.length},risks:risks.slice(0,20),overdue:overdue.slice(0,30),recommendations:[...(overdue.length?['Prioritize overdue tasks and confirm revised delivery dates.']:[]),...(unassigned.length?['Assign owners to unassigned tasks.']:[]),...(risks.length?['Escalate high-risk deliverables to regional management.']:[])]});
 }
 if(path==='/api/customers/activities/update'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const activity=await env.DB.prepare("SELECT a.id,c.country_code FROM customer_activities a JOIN customers c ON c.id=a.customer_id WHERE a.id=? AND c.organization_id='hmt'").bind(String(data.id||'')).first();
  if(!activity||!await allowedCountry(env,user,activity.country_code))return authJson({error:'Forbidden'},403);
  const status=String(data.status||'');
  if(!['open','in_progress','on_hold','completed','cancelled'].includes(status))return authJson({error:'Invalid status'},400);
  const title=String(data.title||'').trim(),notes=String(data.notes||'');
  if(title.length<3||title.length>180||notes.length>2000)return authJson({error:'Invalid title or notes'},400);
  const owner=String(data.owner_id||'').trim();
  if(owner){const target=await env.DB.prepare("SELECT id,country_code FROM users WHERE id=? AND account_status='active'").bind(owner).first();if(!target||target.country_code!==activity.country_code&&!r.includes('super_admin'))return authJson({error:'Owner is not eligible for this country'},400);}
  const due=String(data.due_date||'');
  if(due&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(due))return authJson({error:'Invalid date'},400);
  await env.DB.batch([
   env.DB.prepare("UPDATE customer_activities SET title=?,status=?,reference=?,notes=?,due_date=?,owner_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(title,status,String(data.reference||'').slice(0,80),notes,due||null,owner||null,activity.id),
   env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'customer_activity_updated',?,?)").bind(crypto.randomUUID(),user.id,activity.id,activity.country_code)
  ]);
  return authJson({ok:true});
 }
 if(path==='/api/customers/activities'&&method==='GET'){
  const id=url.searchParams.get('customer_id')||'';
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT a.id,a.activity_type,a.title,a.status,a.reference,a.due_date,a.notes,a.created_at,a.owner_id,u.display_name AS owner FROM customer_activities a LEFT JOIN users u ON u.id=a.owner_id WHERE a.customer_id=? ORDER BY a.created_at DESC LIMIT 200").bind(id).all();
  return authJson({activities:rows.results});
 }
 if(path==='/api/customers/activities'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const id=String(data.customer_id||''),type=String(data.activity_type||''),title=String(data.title||'').trim();
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  if(!['project','support','contract','quotation','opportunity'].includes(type)||title.length<3||title.length>180)return authJson({error:'Invalid activity details'},400);
  const due=String(data.due_date||'');
  if(due&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(due))return authJson({error:'Invalid due date'},400);
  const activityId=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO customer_activities(id,customer_id,activity_type,title,status,reference,owner_id,due_date,notes,created_by) VALUES(?,?,?,?,'open',?,?,?,?,?)").bind(activityId,id,type,title,String(data.reference||'').slice(0,80),user.id,due||null,String(data.notes||'').slice(0,2000),user.id),
   env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'customer_activity_created',?,?)").bind(crypto.randomUUID(),user.id,activityId,customer.country_code)
  ]);
  return authJson({ok:true,id:activityId},201);
 }
 if(path==='/api/customers/contacts'&&method==='GET'){
  const id=url.searchParams.get('customer_id')||'';
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT id,name,email,phone,job_title FROM customer_contacts WHERE customer_id=? ORDER BY name").bind(id).all();
  return authJson({contacts:rows.results});
 }
 if(path==='/api/customers/contacts'&&method==='POST'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const customer=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(String(data.customer_id||'')).first();
  if(!customer||!await allowedCountry(env,user,customer.country_code))return authJson({error:'Forbidden'},403);
  const name=String(data.name||'').trim();
  if(name.length<2||name.length>120||data.email&&!validEmail(data.email))return authJson({error:'Invalid contact details'},400);
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO customer_contacts(id,customer_id,name,email,phone,job_title) VALUES(?,?,?,?,?,?)").bind(id,data.customer_id,name,String(data.email||'').slice(0,254),String(data.phone||'').slice(0,80),String(data.job_title||'').slice(0,120)).run();
  return authJson({ok:true,id},201);
 }
 if(path==='/api/admin/country-overview'&&method==='GET'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const countryNames={MU:'Mauritius',MG:'Madagascar',RW:'Rwanda',BI:'Burundi'};
  const result=[];
  for(const country of Object.keys(countryNames)){
   if(!await allowedCountry(env,user,country))continue;
   const [u,registrations,leads]=await Promise.all([
    env.DB.prepare("SELECT account_status,COUNT(*) AS total FROM users WHERE country_code=? AND id NOT IN (SELECT user_id FROM account_deletions) GROUP BY account_status").bind(country).all(),
    env.DB.prepare("SELECT status,COUNT(*) AS total FROM registration_requests WHERE country_code=? GROUP BY status").bind(country).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM country_leads cl JOIN users u ON u.id=cl.user_id WHERE cl.country_code=? AND u.account_status='active'").bind(country).first()
   ]);
   const byStatus=Object.fromEntries(registrations.results.map(x=>[x.status,x.total]));
   result.push({country_code:country,country_name:countryNames[country],active_users:u.results.find(x=>x.account_status==='active')?.total||0,inactive_users:u.results.find(x=>x.account_status==='inactive')?.total||0,pending_verification:byStatus.pending_verification||0,pending_approval:byStatus.pending_approval||0,approved:byStatus.approved||0,rejected:byStatus.rejected||0,active_leads:leads.total||0});
  }
  return authJson({countries:result});
 }
 if(path==='/api/admin/users/manage'&&method==='POST'){
  const action=String(data.action||''),id=String(data.id||'');
  if(!['disable','enable','delete','reset_password'].includes(action)||!id)return authJson({error:'Invalid account action'},400);
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Only Super Administrators and Country Leads may manage accounts'},403);
  const target=await env.DB.prepare("SELECT u.id,u.email,u.display_name,u.country_code,u.account_status,d.user_id AS deleted FROM users u LEFT JOIN account_deletions d ON d.user_id=u.id WHERE u.id=?").bind(id).first();
  if(!target)return authJson({error:'Account not found'},404);
  if(id===user.id)return authJson({error:'You cannot change your own account status or password through administration'},403);
  const targetRoles=await roles(env,id);
  if(targetRoles.includes('super_admin'))return authJson({error:'Super Administrator accounts are protected'},403);
  if(!r.includes('super_admin')&&(targetRoles.includes('country_lead')||targetRoles.includes('admin')||!await allowedCountry(env,user,target.country_code)))return authJson({error:'Country Leads may manage only standard accounts in their assigned country'},403);
  if(target.deleted)return authJson({error:'This account has been deleted (retained for audit). Contact a Super Administrator for recovery.'},409);
  if(action==='reset_password'){
   if(target.account_status!=='active')return authJson({error:'Enable this account before resetting its password'},409);
   if(target.email!=='roshan.parmessa@gmail.com')return authJson({error:'Password reset email is restricted to the verified pilot inbox until a sending domain is configured'},403);
   const token=random(),hash=await digest(token);
   await env.DB.prepare("INSERT INTO account_password_resets(user_id,token_hash,expires_at,requested_by) VALUES(?,?,datetime('now','+30 minutes'),?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,consumed_at=NULL,requested_by=excluded.requested_by,created_at=CURRENT_TIMESTAMP").bind(id,hash,user.id).run();
   const {sendTestEmail}=await import('./email.js');
   const link=url.origin+'/account?reset='+encodeURIComponent(token);
   const sent=await sendTestEmail(env,{subject:'HMT Collabs — reset your password',text:'An account administrator requested a password reset. This link expires in 30 minutes.\\n'+link+'\\nIf unexpected, contact your administrator.'}).catch(()=>({ok:false}));
   await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code,details) VALUES(?,?,'password_reset_requested',?,?,?)").bind(crypto.randomUUID(),user.id,id,target.country_code,sent.ok?'Pilot reset email sent':'Pilot reset email failed').run();
   return sent.ok?authJson({ok:true,message:'Password reset link sent to the account email.'}):authJson({error:'Reset link created but email delivery failed; retry to generate a fresh link'},502);
  }
  if(action==='enable'&&(!target.password_hash||!target.password_salt))return authJson({error:'This account has no password. Complete its activation first.'},409);
  const next=action==='enable'?'active':'inactive';
  const statements=[env.DB.prepare("UPDATE users SET account_status=? WHERE id=?").bind(next,id),env.DB.prepare("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL").bind(id),env.DB.prepare("DELETE FROM account_password_resets WHERE user_id=?").bind(id),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),user.id,'account_'+action,id,target.country_code)];
  if(action==='delete'){statements.push(env.DB.prepare("INSERT INTO account_deletions(user_id,deleted_by) VALUES(?,?)").bind(id,user.id));statements.push(env.DB.prepare("DELETE FROM country_leads WHERE user_id=?").bind(id));}
  await env.DB.batch(statements);
  return authJson({ok:true,message:action==='delete'?'Account deleted from active management, access revoked; audit history retained.':'Account '+(action==='enable'?'enabled':'disabled')+'; existing sessions revoked.'});
 }
 if(path==='/api/admin/users'&&method==='GET'){
  if(!r.includes('super_admin')&&!r.includes('country_lead'))return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT u.id,u.email,u.display_name,u.country_code,u.account_status,u.created_at,d.user_id AS deleted FROM users u LEFT JOIN account_deletions d ON d.user_id=u.id ORDER BY u.created_at DESC LIMIT 200").all();
  const visible=[];for(const item of rows.results){if(r.includes('super_admin')||(!item.deleted&&await allowedCountry(env,user,item.country_code)))visible.push(item);}
  return authJson({users:visible});
 }
 if(path==='/api/admin/users'&&method==='POST'){
  if(!admin)return authJson({error:'Forbidden'},403);
  if(!validEmail(data.email)||!securePassword(data.password)||typeof data.display_name!=='string'||data.display_name.length<2||!['MU','MG','RW','BI'].includes(data.country_code)||!['admin','country_lead','regional_manager','group_leader','technician','requester'].includes(data.role))return authJson({error:'Invalid account details'},400);
  const id=crypto.randomUUID(),salt=random(),hash=await passwordHash(data.password,salt);
  try{await env.DB.batch([env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,country_code,account_status,password_salt,password_hash,password_iterations,password_changed_at) VALUES(?,'hmt',?,?, 'requester',?,'inactive',?,?,100000,CURRENT_TIMESTAMP)").bind(id,data.email.toLowerCase(),data.display_name,data.country_code,salt,hash),env.DB.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').bind(id,data.role),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'user_created',?,?)").bind(crypto.randomUUID(),user.id,id,data.country_code)]);}catch{return authJson({error:'Account could not be created (possibly duplicate email)'},409);}
  return authJson({id,created:true,account_status:'inactive',activation_required:true},201);
 }
 if(path==='/api/admin/country-leads'&&method==='GET'){
  if(!admin)return authJson({error:'Forbidden'},403);
  const rows=await env.DB.prepare("SELECT cl.country_code,u.id AS user_id,u.display_name,u.email,u.account_status FROM country_leads cl JOIN users u ON u.id=cl.user_id ORDER BY cl.country_code,u.display_name").all();
  return authJson({country_leads:rows.results});
 }
 if(path==='/api/admin/country-leads'&&method==='POST'){
  if(!admin)return authJson({error:'Forbidden'},403);
  if(!['MU','MG','RW','BI'].includes(data.country_code)||typeof data.user_id!=='string')return authJson({error:'Invalid assignment'},400);
  const target=await env.DB.prepare("SELECT id FROM users WHERE id=? AND account_status='active'").bind(data.user_id).first();
  if(!target)return authJson({error:'Active user not found'},404);
  await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO user_roles(user_id,role) VALUES(?,?)').bind(data.user_id,'country_lead'),env.DB.prepare('INSERT OR IGNORE INTO country_leads(country_code,user_id) VALUES(?,?)').bind(data.country_code,data.user_id)]);
  return authJson({assigned:true});
 }
 if(path==='/api/admin/registrations/resend'&&method==='POST'){
  if(!admin)return authJson({error:'Forbidden'},403);
  const item=await env.DB.prepare("SELECT id,email FROM registration_requests WHERE id=? AND status='pending_verification'").bind(String(data.id||'')).first();
  if(!item)return authJson({error:'Pending email verification not found'},404);
  if(item.email!=='roshan.parmessa@gmail.com')return authJson({error:'Pilot email recipient restriction'},403);
  const token=random(),hashed=await digest(token);
  await env.DB.prepare("UPDATE registration_requests SET verification_hash=?,verification_expires_at=datetime('now','+30 minutes') WHERE id=? AND status='pending_verification'").bind(hashed,item.id).run();
  const {sendTestEmail}=await import('./email.js');
  const link=url.origin+'/api/auth/verify-registration?token='+encodeURIComponent(token);
  const sent=await sendTestEmail(env,{subject:'HMT Collabs — verify your registration',text:'Please verify your registration within 30 minutes.\n'+link+'\nIf you did not request this, ignore this email.'});
  return sent.ok?authJson({ok:true,message:'A fresh verification email was sent.'}):authJson({error:'Verification email delivery failed'},502);
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
   if(item.email!=='roshan.parmessa@gmail.com')return authJson({error:'Pilot activation is limited to the verified test inbox'},403);
   const token=random(),tokenHash=await digest(token),customerId=crypto.randomUUID();
   try{
    await env.DB.batch([
     env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,country_code,account_status) VALUES(?,'hmt',?,?,'requester',?,'inactive')").bind(customerId,item.email,item.display_name,item.country_code),
     env.DB.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'requester')").bind(customerId),
     env.DB.prepare("INSERT INTO registration_activation_tokens(request_id,user_id,token_hash,expires_at) VALUES(?,?,?,datetime('now','+24 hours'))").bind(item.id,customerId,tokenHash),
     env.DB.prepare("UPDATE registration_requests SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_approval'").bind(user.id,item.id),
     env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code,details) VALUES(?,?,'registration_approved',?,?,?)").bind(crypto.randomUUID(),user.id,item.id,item.country_code,'Invitation generated; account inactive until password setup')
    ]);
   }catch(e){console.error('Registration approval failed',e);return authJson({error:'Could not approve registration and prepare activation'},409);}
   const {sendTestEmail}=await import('./email.js');
   const link=url.origin+'/account?activation='+encodeURIComponent(token);
   const sent=await sendTestEmail(env,{subject:'HMT Collabs — activate your account',text:'Your customer registration has been approved. Set your password within 24 hours using this secure link:\n'+link+'\nIf you did not register, ignore this message.'}).catch(e=>({ok:false,error:String(e)}));
   return authJson({ok:true,status:'approved',activation_pending:true,email_sent:!!sent.ok,message:sent.ok?'Registration approved. Activation invitation sent.':'Registration approved, but activation email delivery failed. Contact the platform administrator.'});
  }
  await env.DB.prepare("UPDATE registration_requests SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_approval'").bind(user.id,item.id).run();
  await env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id,country_code) VALUES(?,?,'registration_rejected',?,?)").bind(crypto.randomUUID(),user.id,item.id,item.country_code).run();
  return authJson({ok:true});
 }
 return authJson({error:'Not found'},404);
}
