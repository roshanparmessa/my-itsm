import {scanContractWorkflows} from './contract-automation.js';
import {entitlementFields,validateEntitlement,slaBalances,hoursMutation} from './sla-entitlements.js';
import { sessionUser, roles } from './auth.js';
export const contractTypes=['maintenance','support','managed_services','subscription','software_license','hardware_warranty','professional_services','supplier','subcontractor','partnership','other'];
export const statuses=['draft','pending_signature','active','on_hold','expired','terminated','archived'];
export const entryFields={
 coverage:['name',...entitlementFields,'manufacturer','product','quantity','site','coverage_start','coverage_end','support_level','exclusions','notes'],
 sla:['name',...entitlementFields,'hours_sold','priority','response_minutes','resolution_minutes','service_hours','escalation_contact','measurement','penalties','notes'],
 renewal:['name','stage','owner','follow_up_date','new_start_date','new_end_date','currency','quoted_amount','quotation_reference','po_reference','document_url','notes'],
 obligation:['name','owner','due_date','status','frequency','notes'],
 document:['name','document_type','reference','document_url','expiry_date','notes']
};
const fields=[...entitlementFields,'owner','technical_owner','contact','billing_frequency','payment_terms','po_reference','scope','exclusions','notice_days','auto_renew','document_url','notes'];
const countries=['MU','MG','RW','BI'];
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function clean(d,keys){const v={};for(const k of keys){const s=d[k]??'';if(typeof s!=='string'||s.length>(['notes','scope','exclusions'].includes(k)?4000:1000))throw Error('Invalid '+k);v[k]=s.trim();if((k.endsWith('_date')||['coverage_start','coverage_end'].includes(k))&&v[k]&&!validDate(v[k]))throw Error('Invalid '+k);if(['amount','quoted_amount','quantity','response_minutes','resolution_minutes','notice_days'].includes(k)&&v[k]&&(!/^\d+(\.\d{1,2})?$/.test(v[k])||!Number.isFinite(Number(v[k]))))throw Error('Invalid '+k);}
 if(v.document_url){const u=new URL(v.document_url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid document URL');}
 for(const [a,b] of [['start_date','end_date'],['coverage_start','coverage_end'],['new_start_date','new_end_date']])if(v[a]&&v[b]&&v[a]>v[b])throw Error('Invalid date range');
 if(v.currency&&!/^[A-Z]{3}$/.test(v.currency))throw Error('Invalid currency: use three uppercase letters');
 if(v.notice_days&&(!Number.isInteger(Number(v.notice_days))||Number(v.notice_days)>3650))throw Error('Invalid notice days');return v;}
export function contractAlerts(items,today=new Date().toLocaleDateString('en-CA',{timeZone:'Indian/Mauritius'})){
 const day=s=>Date.parse(s+'T00:00:00Z');return items.filter(c=>['active','on_hold','expired'].includes(c.status)).flatMap(c=>{const days=Math.round((day(c.end_date)-day(today))/86400000),notice=Number(c.notice_days||0),noticeDate=new Date(day(c.end_date)-notice*86400000).toISOString().slice(0,10);const out=[];
 if(days<=90)out.push({contract_id:c.id,reference:c.reference,title:c.title,organization_name:c.organization_name,country_code:c.country_code,owner:c.owner||'',date:c.end_date,days,category:days<0?'Expired':days<=30?'Within 30 days':days<=60?'Within 60 days':'Within 90 days'});
 if(notice>0&&noticeDate<=new Date(day(today)+90*86400000).toISOString().slice(0,10))out.push({contract_id:c.id,reference:c.reference,title:c.title,organization_name:c.organization_name,country_code:c.country_code,owner:c.owner||'',date:noticeDate,days:Math.round((day(noticeDate)-day(today))/86400000),category:'Notice deadline'+(noticeDate<today?' overdue':'')});return out;}).sort((a,b)=>a.date.localeCompare(b.date));
}
export async function contractsRoute(request,env,url){
 const user=await sessionUser(request,env);if(!user)return json({error:'Sign in required'},401);
 const rr=await roles(env,user.id);if(rr.includes('requester')||!rr.some(r=>['super_admin','admin','country_lead','regional_manager','group_leader','technician'].includes(r)))return json({error:'Internal account required'},403);
 const global=rr.some(r=>['super_admin','admin'].includes(r)),canWrite=rr.some(r=>['super_admin','admin','country_lead'].includes(r));
 const grants=rr.includes('country_lead')?(await env.DB.prepare('SELECT country_code FROM country_leads WHERE user_id=?').bind(user.id).all()).results.map(x=>x.country_code):[user.country_code].filter(Boolean);
 const allowed=c=>global||grants.includes(c),scope=global?'':` AND c.country_code IN (${grants.map(()=>'?').join(',')||'NULL'})`,params=global?[]:grants;
 const base="SELECT k.*,c.name AS organization_name,c.country_code FROM managed_contracts k JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt'";
 if(request.method==='GET'&&url.pathname==='/api/contracts'){
  const rows=await env.DB.prepare(base+scope+' ORDER BY k.end_date,k.reference').bind(...params).all();
  const organizations=await env.DB.prepare("SELECT c.id,c.name,c.country_code FROM customers c WHERE c.organization_id='hmt'"+scope+' ORDER BY c.name').bind(...params).all();
  const entries=(await env.DB.prepare("SELECT e.* FROM contract_entries e JOIN managed_contracts k ON k.id=e.contract_id JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND e.kind='sla'"+scope).bind(...params).all()).results;
  const usage=(await env.DB.prepare("SELECT t.sla_entry_id,SUM(t.hours_units) hours_units FROM sla_time_entries t JOIN managed_contracts k ON k.id=t.contract_id JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND t.status='recorded'"+scope+' GROUP BY t.sla_entry_id').bind(...params).all()).results;
  const balances=slaBalances(entries,usage);
  const items=rows.results.map(({data,...c})=>{const lines=balances.filter(x=>x.contract_id===c.id),missing=lines.filter(x=>x.hours_sold===null).length;const sold=lines.reduce((n,x)=>n+Math.round((x.hours_sold||0)*100),0)/100,used=lines.reduce((n,x)=>n+Math.round(x.hours_used*100),0)/100;return {...JSON.parse(data),...c,hours_sold:sold,hours_used:used,hours_remaining:Math.round((sold-used)*100)/100,slas_missing_hours:missing,sla_count:lines.length};});return json({items,organizations:organizations.results,can_write:canWrite,countries:countries.filter(allowed),types:contractTypes,statuses,entry_fields:entryFields,alerts:contractAlerts(items)});
 }
 const id=url.searchParams.get('id');
 if(request.method==='GET'&&url.pathname==='/api/contracts/detail'&&id){
  const row=await env.DB.prepare(base+' AND k.id=?'+scope).bind(id,...params).first();if(!row)return json({error:'Contract unavailable'},403);
  const r=await env.DB.batch([env.DB.prepare('SELECT id,kind,data,updated_at FROM contract_entries WHERE contract_id=? ORDER BY updated_at DESC,id').bind(id),env.DB.prepare('SELECT a.action,a.created_at,u.display_name AS actor FROM contract_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.contract_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100').bind(id)]);
  const usage=(await env.DB.prepare('SELECT * FROM sla_time_entries WHERE contract_id=? ORDER BY work_date DESC,created_at DESC').bind(id).all()).results;
  return json({entries:r[0].results.map(x=>({...x,data:JSON.parse(x.data)})),audit:r[1].results,hours:slaBalances(r[0].results,usage),time_entries:usage});
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(!canWrite)return json({error:'Only administrators and assigned country leads can make changes'},403);
 if(Number(request.headers.get('content-length')||0)>24000)return json({error:'Request too large'},413);
 let d;try{const raw=await request.text();if(raw.length>24000)return json({error:'Request too large'},413);d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw Error();}catch{return json({error:'Invalid request'},400);}
 const contractId=typeof d.contract_id==='string'?d.contract_id:'';
 let existing=null;if(contractId){existing=await env.DB.prepare(base+' AND k.id=?'+scope).bind(contractId,...params).first();if(!existing)return json({error:'Contract unavailable'},403);}
 const refreshWorkflows=async country=>{try{await scanContractWorkflows(env,{scope:[country],actorId:user.id})}catch(e){console.error('Contract saved; workflow scan deferred',e)}};
 const audit=(id,action,snapshot)=>env.DB.prepare('INSERT INTO contract_audit(id,contract_id,actor_id,action,snapshot) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,user.id,action,JSON.stringify(snapshot));
 try{
  if(url.pathname==='/api/contracts/hours')return await hoursMutation(env,d,existing,user,audit,refreshWorkflows);
  if(url.pathname==='/api/contracts/save'){
   const v=clean(d,['reference','title','customer_id','contract_type','status','start_date','end_date','currency','amount',...fields]);
   if(v.title.length<2||v.title.length>180||!v.reference||v.reference.length>100||!contractTypes.includes(v.contract_type)||!statuses.includes(v.status)||!validDate(v.start_date)||!validDate(v.end_date)||!v.currency)throw Error('Invalid required contract fields');
   if(v.auto_renew&&!['yes','no'].includes(v.auto_renew))throw Error('Invalid auto renewal');
   validateEntitlement(v,{mixed:true});
   const org=await env.DB.prepare("SELECT id,country_code FROM customers WHERE id=? AND organization_id='hmt'").bind(v.customer_id).first();if(!org||!allowed(org.country_code))return json({error:'Organization unavailable'},403);
   if(existing&&existing.customer_id!==v.customer_id)return json({error:'An existing contract cannot be moved to a different organization'},400);
   const duplicate=await env.DB.prepare('SELECT id FROM managed_contracts WHERE reference=? COLLATE NOCASE AND id<>?').bind(v.reference,contractId).first();if(duplicate)return json({error:'Contract reference is already in use'},409);
   const target=contractId||crypto.randomUUID(),data=JSON.stringify(Object.fromEntries(fields.map(k=>[k,v[k]])));
   const stmt=existing?env.DB.prepare('UPDATE managed_contracts SET reference=?,title=?,contract_type=?,status=?,start_date=?,end_date=?,currency=?,amount=?,data=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(v.reference,v.title,v.contract_type,v.status,v.start_date,v.end_date,v.currency,v.amount,data,target):env.DB.prepare('INSERT INTO managed_contracts(id,customer_id,reference,title,contract_type,status,start_date,end_date,currency,amount,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(target,v.customer_id,v.reference,v.title,v.contract_type,v.status,v.start_date,v.end_date,v.currency,v.amount,data);
   await env.DB.batch([stmt,audit(target,existing?'Contract updated':'Contract created',{before:existing?{...existing,data:JSON.parse(existing.data)}:null,after:v})]);await refreshWorkflows(existing?.country_code||org.country_code);return json({ok:true,id:target});
  }
  if(url.pathname==='/api/contracts/entry'){
   if(!existing)return json({error:'Select a contract'},400);if(!Object.hasOwn(entryFields,d.kind))throw Error('Invalid record type');
   const v=clean(d,entryFields[d.kind]);if(v.name.length<2||v.name.length>180)throw Error('Invalid record name');
   if(['coverage','sla'].includes(d.kind))validateEntitlement(v,{sla:d.kind==='sla'});
   if(d.kind==='renewal'&&!['not_started','preparing','quotation_sent','negotiation','awaiting_po','confirmed','lost','cancelled'].includes(v.stage))throw Error('Invalid renewal stage');
   if(d.kind==='obligation'&&!['pending','in_progress','completed','waived'].includes(v.status))throw Error('Invalid obligation status');
   const entryId=typeof d.entry_id==='string'?d.entry_id:'',before=entryId?await env.DB.prepare('SELECT data FROM contract_entries WHERE id=? AND contract_id=? AND kind=?').bind(entryId,contractId,d.kind).first():null;if(entryId&&!before)return json({error:'Record unavailable'},404);
   const target=entryId||crypto.randomUUID();await env.DB.batch([entryId?env.DB.prepare('UPDATE contract_entries SET data=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND contract_id=?').bind(JSON.stringify(v),target,contractId):env.DB.prepare('INSERT INTO contract_entries(id,contract_id,kind,data) VALUES(?,?,?,?)').bind(target,contractId,d.kind,JSON.stringify(v)),audit(contractId,(entryId?'Updated ':'Added ')+d.kind,{entry_id:target,before:before?JSON.parse(before.data):null,after:v})]);await refreshWorkflows(existing.country_code);return json({ok:true,id:target});
  }
  return json({error:'Not found'},404);
 }catch(e){if(e.message?.startsWith('Invalid')||e instanceof TypeError)return json({error:e.message?.startsWith('Invalid')?e.message:'Invalid value'},400);if(String(e.message).includes('sla_time_entries.id'))return json({error:'Hours were already recorded; refresh before retrying'},409);if(String(e.message).includes('UNIQUE constraint'))return json({error:'Contract reference is already in use'},409);console.error('Contract save failed',e);return json({error:'Unable to save contract record'},500);}
}
