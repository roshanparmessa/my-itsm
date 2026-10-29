import {sessionUser,roles} from './auth.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const TYPES=['project','task','poc','rfp','prospection','quotation','workshop','incident','other'];
const STATUSES=['new','planned','in_progress','waiting','completed','cancelled'];
const PRIORITIES=['low','normal','high','critical'];
const COUNTRIES=['MU','MG','RW','BI'];
const management=rr=>rr.some(x=>['super_admin','admin','country_lead','regional_manager','group_leader'].includes(x));
async function allowedCountries(env,user,rr){
 if(rr.includes('super_admin')||rr.includes('admin') )return COUNTRIES;
 if(rr.includes('regional_manager'))return [user.country_code].filter(x=>COUNTRIES.includes(x));
 if(rr.includes('country_lead')){const rows=await env.DB.prepare('SELECT country_code FROM country_leads WHERE user_id=?').bind(user.id).all();return rows.results.map(x=>x.country_code);}
 return [user.country_code].filter(x=>COUNTRIES.includes(x));
}
export async function regionalRoute(request,env,url){
 const user=await sessionUser(request,env);
 if(!user)return json({error:'Authentication required'},401);
 const rr=await roles(env,user.id);
 if(rr.includes('requester'))return json({error:'Forbidden'},403);
 const countries=await allowedCountries(env,user,rr);
 if(!countries.length)return json({error:'No country access'},403);
 if(request.method==='GET'){
  const country=url.searchParams.get('country');
  if(country&&!countries.includes(country))return json({error:'Country access denied'},403);
  if(url.pathname==='/api/regional/reporting'){
   const where='country_code IN ('+countries.map(()=>'?').join(',')+')'+(country?' AND country_code=?':'');
   const args=[...countries,...(country?[country]:[])];
   const totals=await env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('new','planned','in_progress','waiting') THEN 1 ELSE 0 END) open, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed, SUM(CASE WHEN due_date < date('now') AND status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) overdue, SUM(CASE WHEN priority='critical' AND status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) critical FROM regional_activities WHERE "+where).bind(...args).first();
   const byCountry=await env.DB.prepare('SELECT country_code,COUNT(*) total,SUM(CASE WHEN status IN (\'new\',\'planned\',\'in_progress\',\'waiting\') THEN 1 ELSE 0 END) open FROM regional_activities WHERE '+where+' GROUP BY country_code ORDER BY country_code').bind(...args).all();
   const byType=await env.DB.prepare('SELECT activity_type,COUNT(*) total FROM regional_activities WHERE '+where+' GROUP BY activity_type ORDER BY total DESC').bind(...args).all();
   const byOwner=await env.DB.prepare('SELECT COALESCE(u.display_name,\'Unassigned\') owner,COUNT(*) total,SUM(CASE WHEN a.status NOT IN (\'completed\',\'cancelled\') THEN 1 ELSE 0 END) open FROM regional_activities a LEFT JOIN users u ON u.id=a.owner_id WHERE a.'+where.replaceAll('country_code','a.country_code')+' GROUP BY a.owner_id ORDER BY open DESC LIMIT 12').bind(...args).all();
   return json({totals,byCountry:byCountry.results,byType:byType.results,byOwner:byOwner.results,countries});
  }
  const sql='SELECT a.*,u.display_name AS owner_name FROM regional_activities a LEFT JOIN users u ON u.id=a.owner_id WHERE a.country_code IN ('+countries.map(()=>'?').join(',')+')'+(country?' AND a.country_code=?':'')+' ORDER BY a.updated_at DESC LIMIT 200';
  const rows=await env.DB.prepare(sql).bind(...countries,...(country?[country]:[])).all();
  const users=await env.DB.prepare("SELECT id,display_name,country_code FROM users WHERE organization_id='hmt' AND account_status='active' ORDER BY display_name LIMIT 500").all();
  const owners=users.results.filter(x=>countries.includes(x.country_code)||rr.includes('super_admin')||rr.includes('admin'));
  return json({activities:rows.results,countries,types:TYPES,statuses:STATUSES,priorities:PRIORITIES,owners});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(!management(rr))return json({error:'Insufficient permissions'},403);
 let data;try{data=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 if(!data||typeof data!=='object')return json({error:'Invalid payload'},400);
 if(url.pathname==='/api/regional/activities'){
  const title=String(data.title||'').trim(),description=String(data.description||'').trim();
  if(title.length<3||title.length>160||description.length>4000||!TYPES.includes(data.activity_type)||!STATUSES.includes(data.status||'new')||!PRIORITIES.includes(data.priority||'normal')||!countries.includes(data.country_code))return json({error:'Invalid activity details or country scope'},400);
  const due=data.due_date||null;
  if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))return json({error:'Invalid due date'},400);
  const owner=data.owner_id||user.id;
  const ownerRow=await env.DB.prepare("SELECT id FROM users WHERE id=? AND account_status='active' AND organization_id='hmt'").bind(owner).first();
  if(!ownerRow)return json({error:'Invalid owner'},400);
  if(owner!==user.id&&!rr.includes('super_admin')&&!rr.includes('admin')){const assigned=await env.DB.prepare('SELECT country_code FROM users WHERE id=?').bind(owner).first();if(!assigned||assigned.country_code!==data.country_code)return json({error:'Owner must belong to the selected country'},403)}
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO regional_activities(id,title,activity_type,status,priority,country_code,owner_id,description,due_date,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,title,data.activity_type,data.status||'new',data.priority||'normal',data.country_code,owner,description,due,user.id).run();
  return json({ok:true,id},201);
 }
 if(url.pathname==='/api/regional/activities/note'){
  const item=await env.DB.prepare('SELECT id,country_code FROM regional_activities WHERE id=?').bind(String(data.id||'')).first();
  if(!item||!countries.includes(item.country_code))return json({error:'Activity not found'},404);
  const note=String(data.note||'').trim();
  if(note.length<3||note.length>2000)return json({error:'Progress note must be 3–2000 characters'},400);
  await env.DB.prepare('INSERT INTO regional_activity_updates(id,activity_id,author_id,note) VALUES(?,?,?,?)').bind(crypto.randomUUID(),item.id,user.id,note).run();
  return json({ok:true});
 }
 if(url.pathname==='/api/regional/activities/assign'){
  const item=await env.DB.prepare('SELECT id,country_code FROM regional_activities WHERE id=?').bind(String(data.id||'')).first();
  if(!item||!countries.includes(item.country_code))return json({error:'Activity not found'},404);
  const owner=await env.DB.prepare("SELECT id,country_code FROM users WHERE id=? AND organization_id='hmt' AND account_status='active'").bind(String(data.owner_id||'')).first();
  if(!owner||(!rr.includes('super_admin')&&!rr.includes('admin')&&owner.country_code!==item.country_code))return json({error:'Owner not eligible for activity country'},403);
  await env.DB.prepare('UPDATE regional_activities SET owner_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(owner.id,item.id).run();
  return json({ok:true});
 }
 if(url.pathname==='/api/regional/activities/update'){
  const item=await env.DB.prepare('SELECT id,country_code,owner_id FROM regional_activities WHERE id=?').bind(String(data.id||'')).first();
  if(!item||!countries.includes(item.country_code))return json({error:'Activity not found or forbidden'},404);
  if(!STATUSES.includes(data.status))return json({error:'Invalid status'},400);
  await env.DB.prepare('UPDATE regional_activities SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(data.status,item.id).run();
  return json({ok:true});
 }
 return json({error:'Not found'},404);
}
