import {sessionUser} from './auth.js';
import {newChallenge,sha256,verifyMicrosoftIdToken} from './oidc.js';
const json=(error,status=400)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const redirect=(url,headers={})=>new Response(null,{status:302,headers:{location:url,'cache-control':'no-store',...headers}});
const callback=url=>url.origin+'/api/auth/sso/callback';
export async function ssoRoute(request,env,url){
 const settings=await env.DB.prepare("SELECT mode,tenant_id,client_id,issuer FROM identity_provider_settings WHERE id='default'").first();
 if(settings?.mode!=='hybrid'||!settings.tenant_id||!settings.client_id)return json('SSO is not configured',404);
 if(url.pathname==='/api/auth/sso/start'){
  if(request.method!=='GET')return json('Method not allowed',405);
  const state=newChallenge(),nonce=newChallenge(),verifier=newChallenge();const linking=url.searchParams.get('action')==='link';const localUser=linking?await sessionUser(request,env):null;if(linking&&!localUser)return json('Sign in internally first',401);
  await env.DB.prepare("INSERT INTO oidc_login_states(state_hash,nonce_hash,code_verifier,expires_at,linking_user_id) VALUES(?,?,?,datetime('now','+5 minutes'),?)").bind(await sha256(state),await sha256(nonce),verifier,localUser?.id||null).run();
  const params=new URLSearchParams({client_id:settings.client_id,response_type:'code',redirect_uri:callback(url),response_mode:'query',scope:'openid profile email',state,nonce,code_challenge:await sha256(verifier),code_challenge_method:'S256',prompt:'select_account'});
  return redirect('https://login.microsoftonline.com/'+settings.tenant_id+'/oauth2/v2.0/authorize?'+params.toString(),{'set-cookie':'hmt_oidc_nonce='+nonce+'; Path=/api/auth/sso; Secure; HttpOnly; SameSite=Lax; Max-Age=300'});
 }
 if(url.pathname==='/api/auth/sso/callback'){
  if(request.method!=='GET')return json('Method not allowed',405);
  const state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!state||!code)return json('Sign-in was cancelled',401);
  const nonce=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hmt_oidc_nonce='))?.slice(15);
  if(!nonce)return json('Missing sign-in challenge',401);
  const stateHash=await sha256(state);
  const record=await env.DB.prepare("SELECT nonce_hash,code_verifier,linking_user_id FROM oidc_login_states WHERE state_hash=? AND expires_at>datetime('now')").bind(stateHash).first();
  if(!record||record.nonce_hash!==await sha256(nonce))return json('Invalid or expired sign-in challenge',401);
  await env.DB.prepare("DELETE FROM oidc_login_states WHERE state_hash=?").bind(stateHash).run();
  const body=new URLSearchParams({client_id:settings.client_id,grant_type:'authorization_code',code,redirect_uri:callback(url),code_verifier:record.code_verifier});
  const tokenResponse=await fetch('https://login.microsoftonline.com/'+settings.tenant_id+'/oauth2/v2.0/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!tokenResponse.ok)return json('Microsoft sign-in failed',401);
  let claims;try{const tokens=await tokenResponse.json();claims=await verifyMicrosoftIdToken(tokens.id_token,settings,nonce)}catch(e){console.error('OIDC verification error',e);return json('Identity verification failed',401)}
  if(record.linking_user_id){
   const active=await env.DB.prepare("SELECT id FROM users WHERE id=? AND account_status='active' AND organization_id='hmt'").bind(record.linking_user_id).first();
   if(!active)return json('Internal account inactive',403);
   const existing=await env.DB.prepare("SELECT user_id FROM federated_identities WHERE provider='microsoft_entra' AND issuer=? AND subject=?").bind(claims.iss,claims.sub).first();
   if(existing)return json('Microsoft identity already linked',409);
   const pending=await env.DB.prepare("SELECT id FROM sso_link_requests WHERE issuer=? AND subject=?").bind(claims.iss,claims.sub).first();
   if(pending)return json('A request already exists',409);
   await env.DB.batch([
    env.DB.prepare("INSERT INTO sso_link_requests(id,user_id,issuer,subject,status) VALUES(?,?,?,?,'pending')").bind(crypto.randomUUID(),active.id,claims.iss,claims.sub),
    env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type,target_id) VALUES(?,?,'sso_link_requested',?)").bind(crypto.randomUUID(),active.id,active.id)
   ]);
   return redirect(url.origin+'/module/admin?sso_link=pending');
  }
  const account=await env.DB.prepare("SELECT u.id FROM federated_identities f JOIN users u ON u.id=f.user_id WHERE f.provider='microsoft_entra' AND f.issuer=? AND f.subject=? AND u.account_status='active' AND u.organization_id='hmt'").bind(claims.iss,claims.sub).first();
  if(!account)return json('Account is not linked. Contact the platform administrator.',403);
  const assigned=await env.DB.prepare("SELECT role FROM user_roles WHERE user_id=?").bind(account.id).all();
  if(assigned.results.some(x=>x.role==='requester')&&assigned.results.some(x=>x.role!=='requester'))return json('Conflicting account roles',403);
  const session=newChallenge();
  await env.DB.batch([env.DB.prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at) VALUES(?,?,datetime('now','+8 hours'))").bind(await sha256(session),account.id),env.DB.prepare("INSERT INTO identity_audit(id,actor_id,event_type) VALUES(?,?,'sso_login')").bind(crypto.randomUUID(),account.id)]);
  return redirect(url.origin+'/module/admin',{'set-cookie':'hmt_session='+session+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'});
 }
 return json('Not found',404);
}
