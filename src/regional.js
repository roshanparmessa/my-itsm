import {configuredWorkflows} from './governance.js';
import {sessionUser,roles} from './auth.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const TYPES=['project','task','poc','rfp','prospection','quotation','workshop','incident','other'];
const STATUSES=['new','planned','in_progress','waiting','completed','cancelled'];
const WORKFLOWS={technical:{types:['project','task','poc','assessment','workshop','implementation','migration','incident','support'],statuses:['new','planning','in_progress','on_hold','awaiting_customer','testing','completed','cancelled']},financial:{types:['prospection','opportunity','rfp','quotation','tender','contract','renewal'],statuses:['identified','qualification','preparing_proposal','submitted','negotiation','awaiting_po','won','lost','cancelled']}};
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
   const byOwner=await env.DB.prepare('SELECT COALESCE(u.display_name,\'Unassigned\') owner,COUNT(*) total,SUM(CASE WHEN a.status NOT IN (\'completed\',\'cancelled\') THEN 1 ELSE 0 END) open FROM regional_activities a LEFT JOIN users u ON u.id=a.owner_id WHERE '+where.replaceAll('country_code','a.country_code')+' GROUP BY a.owner_id ORDER BY open DESC LIMIT 12').bind(...args).all();
   return json({totals,byCountry:byCountry.results,byType:byType.results,byOwner:byOwner.results,countries});
  }
  const sql='SELECT a.*,u.display_name AS owner_name,c.name AS customer_name FROM regional_activities a LEFT JOIN users u ON u.id=a.owner_id LEFT JOIN customers c ON c.id=a.customer_id AND c.organization_id=\'hmt\' WHERE a.country_code IN ('+countries.map(()=>'?').join(',')+')'+(country?' AND a.country_code=?':'')+' ORDER BY a.updated_at DESC LIMIT 200';
  const rows=await env.DB.prepare(sql).bind(...countries,...(country?[country]:[])).all();
  const users=await env.DB.prepare("SELECT u.id,u.display_name,u.country_code,d.name AS department_name FROM users u LEFT JOIN enterprise_department_memberships m ON m.user_id=u.id LEFT JOIN enterprise_departments d ON d.id=m.department_id WHERE u.organization_id='hmt' AND u.account_status='active' ORDER BY u.display_name LIMIT 500").all();
  const owners=users.results.filter(x=>countries.includes(x.country_code)||rr.includes('super_admin')||rr.includes('admin'));
  const customerRows=await env.DB.prepare("SELECT id,name,country_code FROM customers WHERE organization_id='hmt' ORDER BY name LIMIT 1000").all();
  const customers=customerRows.results.filter(x=>countries.includes(x.country_code));
  return json({activities:rows.results,countries,types:TYPES,statuses:STATUSES,priorities:PRIORITIES,workflows:await configuredWorkflows(env),owners,customers});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(!management(rr))return json({error:'Insufficient permissions'},403);
 let data;try{data=await request.json()}catch{return json({error:'Invalid JSON'},400)}
 if(!data||typeof data!=='object')return json({error:'Invalid payload'},400);
 if(url.pathname==='/api/regional/activities'){
  const title=String(data.title||'').trim(),description=String(data.description||'').trim();
  const section=String(data.section||'technical'),workflow=(await configuredWorkflows(env))[section],workflowType=String(data.workflow_type||''),workflowStatus=String(data.workflow_status||'');
  if(!workflow||!workflow.types.includes(workflowType)||!workflow.statuses.includes(workflowStatus)||title.length<3||title.length>160||description.length>4000||!PRIORITIES.includes(data.priority||'normal')||!countries.includes(data.country_code))return json({error:'Invalid activity details or country scope'},400);
  const due=data.due_date||null;
  if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))return json({error:'Invalid due date'},400);
  const customerId=String(data.customer_id||'');
  if(!customerId)return json({error:'Select a customer from the customer list'},400);
  const customer=await env.DB.prepare("SELECT id,country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(customerId).first();
  if(!customer||customer.country_code!==data.country_code||!countries.includes(customer.country_code))return json({error:'Customer not found in the selected country'},403);
  const owner=data.owner_id||user.id;
  const ownerRow=await env.DB.prepare("SELECT id FROM users WHERE id=? AND account_status='active' AND organization_id='hmt'").bind(owner).first();
  if(!ownerRow)return json({error:'Invalid owner'},400);
  if(owner!==user.id&&!rr.includes('super_admin')&&!rr.includes('admin')){const assigned=await env.DB.prepare('SELECT country_code FROM users WHERE id=?').bind(owner).first();if(!assigned||assigned.country_code!==data.country_code)return json({error:'Owner must belong to the selected country'},403)}
  const id=crypto.randomUUID();
  const legacyType=TYPES.includes(workflowType)?workflowType:(section==='financial'?'quotation':'task');
  const legacyStatus=STATUSES.includes(workflowStatus)?workflowStatus:(['won'].includes(workflowStatus)?'completed':['lost','cancelled'].includes(workflowStatus)?'cancelled':'in_progress');
  const statements=[env.DB.prepare('INSERT INTO regional_activities(id,title,activity_type,status,priority,country_code,customer_id,owner_id,description,due_date,created_by,section,workflow_type,workflow_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,title,legacyType,legacyStatus,data.priority||'normal',data.country_code,customerId,owner,description,due,user.id,section,workflowType,workflowStatus)];
  if(section==='financial'){
   const amount=Number(data.amount||0),probability=Number(data.probability||0),currency=String(data.currency||'MUR').toUpperCase(),close=String(data.expected_close||'');
   if(!Number.isFinite(amount)||amount<0||amount>1e15||!Number.isInteger(probability)||probability<0||probability>100||!['MUR','USD','EUR','MGA','BIF','RWF'].includes(currency)||(close&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(close)))return json({error:'Invalid financial details'},400);
   statements.push(env.DB.prepare('INSERT INTO regional_activity_financials(activity_id,reference,amount,currency,probability,expected_close) VALUES(?,?,?,?,?,?)').bind(id,String(data.reference||'').slice(0,100),amount,currency,probability,close||null));
  }
  await env.DB.batch(statements);
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
  const detail=await env.DB.prepare('SELECT section FROM regional_activities WHERE id=?').bind(item.id).first();
  const section=detail?.section||'technical';const status=String(data.workflow_status||data.status||'');
  if(!(await configuredWorkflows(env))[section].statuses.includes(status))return json({error:'Invalid section status'},400);
  const legacy=STATUSES.includes(status)?status:status==='won'?'completed':['lost','cancelled'].includes(status)?'cancelled':'in_progress';
  await env.DB.prepare('UPDATE regional_activities SET status=?,workflow_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(legacy,status,item.id).run();
  return json({ok:true});
 }
 return json({error:'Not found'},404);
}
