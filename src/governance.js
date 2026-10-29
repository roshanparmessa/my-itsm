import {sessionUser,roles} from './auth.js';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const COUNTRIES=['MU','MG','RW','BI'];
const BASE={technical:{type:['project','task','poc','assessment','workshop','implementation','migration','incident','support'],status:['new','planning','in_progress','on_hold','awaiting_customer','testing','completed','cancelled']},financial:{type:['prospection','opportunity','rfp','quotation','tender','contract','renewal'],status:['identified','qualification','preparing_proposal','submitted','negotiation','awaiting_po','won','lost','cancelled']}};
export async function governanceRoute(request,env,url){
 const user=await sessionUser(request,env);if(!user)return json({error:'Authentication required'},401);
 const rr=await roles(env,user.id);if(rr.includes('requester'))return json({error:'Forbidden'},403);
 const editor=rr.includes('super_admin');
 const scoped=rr.some(r=>['super_admin','admin'].includes(r))?COUNTRIES:rr.includes('country_lead')?(await env.DB.prepare('SELECT country_code FROM country_leads WHERE user_id=?').bind(user.id).all()).results.map(x=>x.country_code):[user.country_code].filter(x=>COUNTRIES.includes(x));
 if(!scoped.length)return json({error:'No country access'},403);
 if(request.method==='GET'){
  const settings=await env.DB.prepare('SELECT setting_key,setting_value,updated_at FROM enterprise_settings ORDER BY setting_key').all();
  const options=await env.DB.prepare('SELECT id,section,kind,code,label,sort_order,enabled FROM enterprise_workflow_options ORDER BY section,kind,sort_order,label').all();
  const members=await env.DB.prepare("SELECT m.user_id,m.department_id,u.display_name,u.country_code,d.name AS department_name FROM enterprise_department_memberships m JOIN users u ON u.id=m.user_id JOIN enterprise_departments d ON d.id=m.department_id WHERE u.organization_id='hmt' ORDER BY u.display_name").all();
  const users=await env.DB.prepare("SELECT u.id,u.display_name,u.email,u.country_code,u.account_status,COALESCE(m.department_id,'') AS department_id FROM users u LEFT JOIN enterprise_department_memberships m ON m.user_id=u.id WHERE u.organization_id='hmt' AND u.account_status!='deleted' ORDER BY u.display_name LIMIT 1000").all();
  const depts=await env.DB.prepare('SELECT id,name,country_code,manager_id,active FROM enterprise_departments ORDER BY country_code,name').all();
  return json({can_edit:editor,countries:scoped,settings:settings.results,options:options.results,departments:depts.results.filter(x=>scoped.includes(x.country_code)),users:users.results.filter(x=>scoped.includes(x.country_code)),members:members.results.filter(x=>scoped.includes(x.country_code)),defaults:BASE,financial_year:{start_month:Number(settings.results.find(x=>x.setting_key==='fy_start_month')?.setting_value||1)}});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(!editor)return json({error:'Enterprise governance changes require super_admin'},403);
 let d;try{d=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 if(url.pathname==='/api/governance/financial-year'){
  const month=Number(d.start_month);if(!Number.isInteger(month)||month<1||month>12)return json({error:'Start month must be between 1 and 12'},400);
  const key='fy_start_month',value=String(month);const old=await env.DB.prepare('SELECT setting_value FROM enterprise_settings WHERE setting_key=?').bind(key).first();
  await env.DB.batch([env.DB.prepare('INSERT INTO enterprise_settings(setting_key,setting_value,updated_by) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP').bind(key,value,user.id),env.DB.prepare('INSERT INTO enterprise_settings_audit(id,setting_key,old_value,new_value,actor_id) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),key,old?.setting_value||null,value,user.id)]);
  return json({ok:true,start_month:month});
 }
 if(url.pathname==='/api/governance/workflows'){
  const section=String(d.section||''),kind=String(d.kind||''),code=String(d.code||'').trim().toLowerCase(),label=String(d.label||'').trim();
  if(!BASE[section]||!['type','status'].includes(kind)||!/^[a-z][a-z0-9_]{1,39}$/.test(code)||label.length<2||label.length>90)return json({error:'Invalid workflow option'},400);
  const enabled=d.enabled===false?0:1;const order=Number.isInteger(Number(d.sort_order))?Math.max(0,Math.min(10000,Number(d.sort_order))):100;
  await env.DB.prepare('INSERT INTO enterprise_workflow_options(id,section,kind,code,label,sort_order,enabled,updated_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(section,kind,code) DO UPDATE SET label=excluded.label,sort_order=excluded.sort_order,enabled=excluded.enabled,updated_by=excluded.updated_by').bind(crypto.randomUUID(),section,kind,code,label,order,enabled,user.id).run();
  return json({ok:true});
 }
 if(url.pathname==='/api/governance/memberships'){
  const target=await env.DB.prepare("SELECT id,country_code FROM users WHERE id=? AND organization_id='hmt'").bind(String(d.user_id||'')).first();
  if(!target||!scoped.includes(target.country_code))return json({error:'User is outside authorized organization/country'},403);
  const departmentId=String(d.department_id||'');
  const department=departmentId?await env.DB.prepare('SELECT id,country_code,active FROM enterprise_departments WHERE id=?').bind(departmentId).first():null;
  if(departmentId&&(!department||!department.active||department.country_code!==target.country_code))return json({error:'Department must be active and belong to the user country'},400);
  const old=await env.DB.prepare('SELECT department_id FROM enterprise_department_memberships WHERE user_id=?').bind(target.id).first();
  const changes=[departmentId?env.DB.prepare('INSERT INTO enterprise_department_memberships(user_id,department_id,assigned_by) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET department_id=excluded.department_id,assigned_by=excluded.assigned_by,assigned_at=CURRENT_TIMESTAMP').bind(target.id,departmentId,user.id):env.DB.prepare('DELETE FROM enterprise_department_memberships WHERE user_id=?').bind(target.id),env.DB.prepare('INSERT INTO enterprise_department_assignment_audit(id,user_id,previous_department_id,new_department_id,actor_id) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),target.id,old?.department_id||null,departmentId||null,user.id)];
  await env.DB.batch(changes);return json({ok:true});
 }
 if(url.pathname==='/api/governance/departments'){
  const name=String(d.name||'').trim(),country=String(d.country_code||'');
  if(name.length<2||name.length>100||!COUNTRIES.includes(country))return json({error:'Invalid department details'},400);
  await env.DB.prepare('INSERT INTO enterprise_departments(id,name,country_code,created_by) VALUES(?,?,?,?) ON CONFLICT(name,country_code) DO NOTHING').bind(crypto.randomUUID(),name,country,user.id).run();
  return json({ok:true});
 }
 return json({error:'Not found'},404);
}
export async function configuredWorkflows(env){
 const rows=await env.DB.prepare('SELECT section,kind,code,label,enabled FROM enterprise_workflow_options ORDER BY sort_order,label').all();
 const out={};for(const section of Object.keys(BASE)){out[section]={types:BASE[section].type.slice(),statuses:BASE[section].status.slice(),labels:{}}}
 for(const r of rows.results){const obj=out[r.section];if(!obj)continue;const arr=r.kind==='type'?obj.types:obj.statuses;if(r.enabled){if(!arr.includes(r.code))arr.push(r.code)}else{const index=arr.indexOf(r.code);if(index>=0)arr.splice(index,1)}obj.labels[r.code]=r.label}
 return out;
}
