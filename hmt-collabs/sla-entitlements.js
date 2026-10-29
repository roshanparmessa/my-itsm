export const entitlementFields=['category','specific','serial_number','warranty_start_date','warranty_expiry_date','license_reference','license_start_date','license_expiry_date'];
export function hoursUnits(v){if(typeof v!=='string'||!/^\d{1,7}(\.\d{1,2})?$/.test(v)||Number(v)<=0)throw Error('Invalid hours: enter a positive value with at most two decimals');const [whole,dec='']=v.split('.');return Number(whole)*100+Number(dec.padEnd(2,'0'));}
export function validateEntitlement(v,{mixed=false,sla=false}={}){
 if(!(mixed?['hardware','software','mixed']:['hardware','software']).includes(v.category))throw Error('Invalid category: select hardware or software'+(mixed?' or mixed':''));
 if(!v.specific||v.specific.length<2)throw Error('Invalid specific: provide the equipment, product, software or service covered');
 const hardware=['hardware','mixed'].includes(v.category),software=['software','mixed'].includes(v.category);
 if(hardware&&!v.serial_number)throw Error('Invalid serial number: hardware must identify its serial number(s)');
 for(const kind of [hardware?'warranty':null,software?'license':null].filter(Boolean)){const start=v[kind+'_start_date'],end=v[kind+'_expiry_date'];if(!start||!end||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||new Date(start).toISOString().slice(0,10)!==start||new Date(end).toISOString().slice(0,10)!==end||start>end)throw Error('Invalid '+kind+' dates: provide a valid start and expiry date');}
 if(sla)hoursUnits(v.hours_sold);
}
export function slaBalances(entries,usage=[]){return entries.filter(e=>e.kind==='sla').map(e=>{const v=typeof e.data==='string'?JSON.parse(e.data):e.data;let sold=null;try{sold=hoursUnits(v.hours_sold)}catch{}const used=usage.filter(t=>t.sla_entry_id===e.id&&t.status!=='void').reduce((n,t)=>n+Number(t.hours_units||0),0);return {id:e.id,contract_id:e.contract_id,name:v.name,category:v.category||'',specific:v.specific||'',hours_sold:sold===null?null:sold/100,hours_used:used/100,hours_remaining:sold===null?null:(sold-used)/100,used_percent:sold===null?null:Math.round(used/sold*10000)/100};});}
export async function hoursMutation(env,d,existing,user,audit,refreshWorkflows){
 const reply=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(!existing)return reply({error:'Select a contract'},400);
 if(d.action&&!['record','void'].includes(d.action))throw Error('Invalid hours action');
 if(d.action==='void'){
  const row=await env.DB.prepare("SELECT * FROM sla_time_entries WHERE id=? AND contract_id=? AND status='recorded'").bind(String(d.time_id||''),existing.id).first();if(!row)return reply({error:'Time entry is unavailable or already voided'},409);
  const reason=String(d.reason||'').trim();if(reason.length<3||reason.length>1000)throw Error('Invalid correction reason');
  await env.DB.batch([env.DB.prepare("UPDATE sla_time_entries SET status='void',void_reason=?,voided_by=?,voided_at=CURRENT_TIMESTAMP WHERE id=? AND contract_id=? AND status='recorded'").bind(reason,user.id,row.id,existing.id),audit(existing.id,'SLA time entry voided',{before:row,after:{...row,status:'void',void_reason:reason}})]);await refreshWorkflows(existing.country_code);return reply({ok:true});
 }
 if(!['active','on_hold','expired'].includes(existing.status))throw Error('Invalid contract status for recording delivered support hours');
 const sla=await env.DB.prepare("SELECT id,data FROM contract_entries WHERE id=? AND contract_id=? AND kind='sla'").bind(String(d.sla_entry_id||''),existing.id).first();if(!sla)return reply({error:'Select an SLA from this contract'},400);
 const definition=JSON.parse(sla.data);hoursUnits(definition.hours_sold);const units=hoursUnits(String(d.hours||''));
 const worked=String(d.work_date||''),today=new Date().toLocaleDateString('en-CA',{timeZone:'Indian/Mauritius'});if(!/^\d{4}-\d{2}-\d{2}$/.test(worked)||!Number.isFinite(Date.parse(worked))||new Date(worked).toISOString().slice(0,10)!==worked||worked>today)throw Error('Invalid work date');
 const engineer=String(d.engineer||'').trim(),notes=String(d.notes||'').trim(),reference=String(d.reference||'').trim();if(engineer.length<2||engineer.length>120||notes.length<3||notes.length>2000||reference.length>200)throw Error('Invalid engineer, work description or reference');
 const id=String(d.request_id||'');if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid request identifier');
 const previous=await env.DB.prepare('SELECT * FROM sla_time_entries WHERE id=? AND contract_id=?').bind(id,existing.id).first();if(previous){if(previous.sla_entry_id===sla.id&&previous.hours_units===units&&previous.work_date===worked&&previous.engineer===engineer&&previous.notes===notes&&previous.reference===reference)return reply({ok:true,id,replayed:true});return reply({error:'Request identifier was already used'},409);}
 const after={id,sla_entry_id:sla.id,hours:units/100,work_date:worked,engineer,reference,notes};
 await env.DB.batch([env.DB.prepare('INSERT INTO sla_time_entries(id,contract_id,sla_entry_id,hours_units,work_date,engineer,reference,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,existing.id,sla.id,units,worked,engineer,reference,notes,user.id),audit(existing.id,'SLA support hours recorded',{before:null,after})]);await refreshWorkflows(existing.country_code);return reply({ok:true,id});
}
