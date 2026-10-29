import { sessionUser, roles } from './auth.js';
export const types=['customer','prospect','partner','supplier','contractor','subcontractor','oem','distributor','reseller','service_provider','consultant','other'];
const countries=['MU','MG','RW','BI'];
export const entryFields={
 site:['name','address','city','country','site_contact','phone','service_hours','notes'],
 capability:['name','category','brands','technologies','services','territories','support_level','notes'],
 agreement:['name','reference','agreement_type','start_date','end_date','currency','amount','payment_terms','sla','document_url','status','notes'],
 qualification:['name','qualification_type','reference','issuer','expiry_date','document_url','status','notes'],
 interaction:['name','interaction_type','date','next_action_date','owner','outcome','notes'],
 relationship:['name','relationship_type','related_organization_id','scope','start_date','end_date','notes']
};
const profileFields=['legal_name','registration_number','tax_number','industry','website','email','phone','address','city','postal_code','billing_address','currency','payment_terms','credit_limit','account_manager','technical_owner','service_coverage','support_hours','escalation_contact','notes'];
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
function clean(obj,fields){const result={};for(const k of fields){const v=obj[k]??'';if(typeof v!=='string'||v.length>(k==='notes'?4000:1000))throw Error('Invalid '+k);result[k]=v.trim();}for(const k of ['website','document_url'])if(result[k]){let u;try{u=new URL(result[k])}catch{throw Error('Invalid URL')}if(!['https:','http:'].includes(u.protocol))throw Error('Use an HTTP or HTTPS URL');}for(const k of ['start_date','end_date','expiry_date','date','next_action_date'])if(result[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(result[k]))throw Error('Invalid date');if(result.start_date&&result.end_date&&result.start_date>result.end_date)throw Error('End date must follow start date');if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw Error('Invalid email');for(const k of ['amount','credit_limit'])if(result[k]&&(!Number.isFinite(Number(result[k]))||Number(result[k])<0))throw Error('Invalid '+k);return result;}
export async function organizationsRoute(request,env,url){
 const user=await sessionUser(request,env);if(!user)return json({error:'Sign in required'},401);
 const rr=await roles(env,user.id);if(rr.includes('requester')||!rr.some(r=>['super_admin','admin','country_lead','regional_manager','group_leader','technician'].includes(r)))return json({error:'Internal account required'},403);
 const global=rr.some(r=>['super_admin','admin'].includes(r));
 const grants=rr.includes('country_lead')?(await env.DB.prepare('SELECT country_code FROM country_leads WHERE user_id=?').bind(user.id).all()).results.map(x=>x.country_code):[user.country_code].filter(Boolean);
 const allowed=c=>global||grants.includes(c);const canWrite=rr.some(r=>['super_admin','admin','country_lead'].includes(r));
 const audit=(id,action)=>env.DB.prepare('INSERT INTO business_audit(id,customer_id,actor_id,action) VALUES(?,?,?,?)').bind(crypto.randomUUID(),id,user.id,action);
 if(request.method==='GET'&&url.pathname==='/api/organizations'){
  const rows=await env.DB.prepare("SELECT c.id,c.name,c.country_code,c.created_at,p.data,p.updated_at FROM customers c LEFT JOIN business_profiles p ON p.customer_id=c.id WHERE c.organization_id='hmt' ORDER BY c.name").all();
  const items=rows.results.filter(x=>allowed(x.country_code)).map(x=>({...x,...JSON.parse(x.data||'{}'),data:undefined}));
  return json({items,can_write:canWrite,countries:global?countries:countries.filter(allowed),types,entry_fields:entryFields});
 }
 const id=url.searchParams.get('id');
 if(request.method==='GET'&&id){
  const c=await env.DB.prepare("SELECT id,country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(id).first();if(!c||!allowed(c.country_code))return json({error:'Organization unavailable'},403);
  const results=await env.DB.batch([
   env.DB.prepare('SELECT * FROM customer_contacts WHERE customer_id=? ORDER BY name').bind(id),
   env.DB.prepare('SELECT id,kind,data,updated_at FROM business_entries WHERE customer_id=? ORDER BY updated_at DESC').bind(id),
   env.DB.prepare('SELECT a.action,a.created_at,u.display_name AS actor FROM business_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.customer_id=? ORDER BY a.created_at DESC LIMIT 100').bind(id),
   env.DB.prepare("SELECT 'Activity' AS category,title,status,due_date FROM customer_activities WHERE customer_id=? UNION ALL SELECT kind,title,stage,due_date FROM commercial_records WHERE customer_id=? UNION ALL SELECT 'Ticket',title,status,resolution_due_at FROM service_tickets WHERE customer_id=? UNION ALL SELECT 'Task',title,status,due_date FROM work_tasks WHERE customer_id=? LIMIT 300").bind(id,id,id,id)
  ]);return json({contacts:results[0].results,entries:results[1].results.map(x=>({...x,data:JSON.parse(x.data)})),audit:results[2].results,activities:results[3].results});
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(!canWrite)return json({error:'Only administrators and assigned country leads can make changes'},403);
 let d;try{const raw=await request.text();if(raw.length>24000)return json({error:'Request too large'},413);d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw Error();}catch{return json({error:'Invalid request'},400);}
 try{
  const orgId=String(d.customer_id||d.id||'');let existing=null;
  if(orgId){existing=await env.DB.prepare("SELECT id,country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(orgId).first();if(!existing||!allowed(existing.country_code))return json({error:'Organization unavailable'},403);}
  if(url.pathname==='/api/organizations/save'){
   const data=clean(d,profileFields),name=String(d.name||'').trim(),country=String(d.country_code||'');
   if(name.length<2||name.length>180||!countries.includes(country)||!allowed(country))return json({error:'Invalid name or unauthorized country'},400);
   if(!Array.isArray(d.types)||!d.types.length||d.types.some(t=>!types.includes(t)))return json({error:'Select at least one organization type'},400);
   if(!['active','prospect','on_hold','inactive','archived'].includes(d.status))return json({error:'Invalid status'},400);
   const duplicate=await env.DB.prepare("SELECT id FROM customers WHERE organization_id='hmt' AND lower(trim(name))=lower(?) AND country_code=? AND id<>?").bind(name,country,orgId).first();if(duplicate)return json({error:'This organization already exists in that country'},409);
   data.types=[...new Set(d.types)];data.status=d.status;const target=orgId||crypto.randomUUID();
   await env.DB.batch([existing?env.DB.prepare('UPDATE customers SET name=?,country_code=? WHERE id=?').bind(name,country,target):env.DB.prepare("INSERT INTO customers(id,organization_id,name,country_code) VALUES(?,'hmt',?,?)").bind(target,name,country),env.DB.prepare('INSERT INTO business_profiles(customer_id,data) VALUES(?,?) ON CONFLICT(customer_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP').bind(target,JSON.stringify(data)),audit(target,existing?'Organization updated':'Organization created')]);return json({ok:true,id:target});
  }
  if(!existing)return json({error:'Select an organization'},400);
  if(url.pathname==='/api/organizations/contact'){
   const v=clean(d,['name','email','phone','job_title']);if(v.name.length<2||v.name.length>120)return json({error:'Contact name must be 2–120 characters'},400);
   const contactId=String(d.contact_id||'');if(contactId&&!await env.DB.prepare('SELECT id FROM customer_contacts WHERE id=? AND customer_id=?').bind(contactId,orgId).first())return json({error:'Unknown contact'},404);
   await env.DB.batch([contactId?env.DB.prepare('UPDATE customer_contacts SET name=?,email=?,phone=?,job_title=? WHERE id=? AND customer_id=?').bind(v.name,v.email,v.phone,v.job_title,contactId,orgId):env.DB.prepare('INSERT INTO customer_contacts(id,customer_id,name,email,phone,job_title) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),orgId,v.name,v.email,v.phone,v.job_title),audit(orgId,contactId?'Contact updated':'Contact added')]);return json({ok:true});
  }
  if(url.pathname==='/api/organizations/entry'){
   const kind=String(d.kind||'');if(!Object.hasOwn(entryFields,kind))return json({error:'Invalid record type'},400);const v=clean(d,entryFields[kind]);if(v.name.length<2||v.name.length>180)return json({error:'Record name must be 2–180 characters'},400);
   if(kind==='relationship'){const target=await env.DB.prepare("SELECT country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(v.related_organization_id).first();if(!target||!allowed(target.country_code)||v.related_organization_id===orgId)return json({error:'Select another organization you can access'},400);}
   const entryId=String(d.entry_id||'');if(entryId&&!await env.DB.prepare('SELECT id FROM business_entries WHERE id=? AND customer_id=? AND kind=?').bind(entryId,orgId,kind).first())return json({error:'Unknown record'},404);
   await env.DB.batch([entryId?env.DB.prepare('UPDATE business_entries SET data=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND customer_id=?').bind(JSON.stringify(v),entryId,orgId):env.DB.prepare('INSERT INTO business_entries(id,customer_id,kind,data) VALUES(?,?,?,?)').bind(crypto.randomUUID(),orgId,kind,JSON.stringify(v)),audit(orgId,(entryId?'Updated ':'Added ')+kind)]);return json({ok:true});
  }
  return json({error:'Not found'},404);
 }catch(e){if(e.message?.startsWith('Invalid')||/^(Use |End date)/.test(e.message))return json({error:e.message},400);console.error('Organization operation failed',e);return json({error:'Unable to save organization record'},500);}
}
