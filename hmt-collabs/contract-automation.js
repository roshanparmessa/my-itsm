import {sessionUser,roles} from './auth.js';
import {slaBalances} from './sla-entitlements.js';
const countries=['MU','MG','RW','BI'];
const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export const workflowRules=[
 ['contract_expiry_90','Contract expires in 61–90 days'],['contract_expiry_60','Contract expires in 31–60 days'],['contract_expiry_30','Contract expires within 30 days'],['contract_expired','Contract end date has passed'],['contract_notice','Cancellation notice deadline due within 30 days or overdue'],['contract_coverage','Coverage entitlement expires within 30 days or has expired'],['contract_document','Document reference expires within 30 days or has expired'],['contract_renewal_followup','Open renewal follow-up is due'],['contract_obligation','Pending obligation is due or overdue'],['contract_owner','Active contract has no assigned owner'],['contract_renewal_gap','Contract ends within 60 days without a live or confirmed renewal']
].map(([id,description])=>({id,description}));
workflowRules.push(...[
 ['contract_warranty','Hardware warranty expires within 30 days or has expired'],['contract_license','Software licence expires within 30 days or has expired'],['contract_asset_data','Hardware/software entitlement details are incomplete'],['contract_sla_hours_missing','An SLA has no valid hours-sold allowance'],['contract_sla_hours_low','An SLA has 20% or less of its hours remaining'],['contract_sla_hours_exhausted','An SLA allowance is exhausted or exceeded']
].map(([id,description])=>({id,description})));
const day=s=>Date.parse(s+'T00:00:00Z');
export function planContractAlerts(contracts,entries,today,usage=[]){
 const alerts=[];const add=(c,rule,message,severity='medium',entry=null,date=null)=>alerts.push({contract_id:c.id,country_code:c.country_code,entity_id:entry?entry.id:c.id,rule,message:c.reference+' · '+message,severity,entry_id:entry?.id||null,due_date:date});
 for(const c of contracts){if(!['active','on_hold','expired'].includes(c.status))continue;const data=JSON.parse(c.data||'{}'),remaining=Math.round((day(c.end_date)-day(today))/86400000),rows=entries.filter(x=>x.contract_id===c.id).map(x=>({...x,v:JSON.parse(x.data)}));
 if(remaining<=90){const rule=remaining<0?'contract_expired':remaining<=30?'contract_expiry_30':remaining<=60?'contract_expiry_60':'contract_expiry_90';add(c,rule,remaining<0?'Contract expired on '+c.end_date:'Contract ends on '+c.end_date,remaining<0?'critical':remaining<=30?'high':'medium',null,c.end_date);}
 const notice=Number(data.notice_days||0);if(notice>0){const due=new Date(day(c.end_date)-notice*86400000).toISOString().slice(0,10);if(day(due)<=day(today)+30*86400000)add(c,'contract_notice','Cancellation notice deadline '+due+(data.auto_renew==='yes'?' · automatic renewal clause recorded':''),due<today?'high':'medium',null,due);}
 if(!data.owner?.trim())add(c,'contract_owner','Contract owner is missing');
 if(remaining<=60&&!rows.some(x=>x.kind==='renewal'&&!['lost','cancelled'].includes(x.v.stage)))add(c,'contract_renewal_gap','Review renewal: no open or confirmed renewal cycle','high',null,c.end_date);
 const entitlement=(v,e=null)=>{const hardware=['hardware','mixed'].includes(v.category),software=['software','mixed'].includes(v.category);let incomplete=!['hardware','software','mixed'].includes(v.category)||!v.specific;
  if(hardware&&(!v.serial_number||!v.warranty_start_date||!v.warranty_expiry_date))incomplete=true;
  if(software&&(!v.license_start_date||!v.license_expiry_date))incomplete=true;
  if(incomplete)add(c,'contract_asset_data',(e?v.name:'Contract')+' has missing category, product, serial number or entitlement dates','medium',e);
  for(const [kind,applies]of [['warranty',hardware],['license',software]]){const expiry=v[kind+'_expiry_date'];if(applies&&expiry&&day(expiry)<=day(today)+30*86400000)add(c,'contract_'+kind,(e?v.name:'Contract')+' '+kind+' expires '+expiry,expiry<today?'high':'medium',e,expiry);}
 };
 entitlement(data);
 for(const balance of slaBalances(rows,usage)){const e=rows.find(x=>x.id===balance.id);if(balance.hours_sold===null)add(c,'contract_sla_hours_missing',balance.name+' has no valid hours-sold allowance','high',e);else if(balance.hours_remaining<=0)add(c,'contract_sla_hours_exhausted',balance.name+' allowance exhausted: '+balance.hours_used+' / '+balance.hours_sold+' hours used',balance.hours_remaining<0?'critical':'high',e);else if(balance.hours_remaining<=balance.hours_sold*0.2)add(c,'contract_sla_hours_low',balance.name+' has '+balance.hours_remaining+' hours remaining ('+balance.used_percent+'% used)','medium',e);}
 for(const e of rows){const v=e.v;
  if(e.kind==='coverage'&&v.coverage_end&&day(v.coverage_end)<=day(today)+30*86400000)add(c,'contract_coverage','Coverage '+v.name+' ends '+v.coverage_end,v.coverage_end<today?'high':'medium',e,v.coverage_end);
  if(['coverage','sla'].includes(e.kind))entitlement(v,e);
  if(e.kind==='document'&&v.expiry_date&&day(v.expiry_date)<=day(today)+30*86400000)add(c,'contract_document','Document '+v.name+' expires '+v.expiry_date,v.expiry_date<today?'high':'medium',e,v.expiry_date);
  if(e.kind==='renewal'&&!['confirmed','lost','cancelled'].includes(v.stage)&&v.follow_up_date&&v.follow_up_date<=today)add(c,'contract_renewal_followup','Renewal follow-up '+v.name+' due '+v.follow_up_date,v.follow_up_date<today?'high':'medium',e,v.follow_up_date);
  if(e.kind==='obligation'&&!['completed','waived'].includes(v.status)&&v.due_date&&v.due_date<=today)add(c,'contract_obligation','Obligation '+v.name+' due '+v.due_date,v.due_date<today?'high':'medium',e,v.due_date);
 }
 }return alerts;
}
export async function scanContractWorkflows(env,{scope=countries,actorId=null}={}){
 scope=scope.filter(c=>countries.includes(c));if(!scope.length)return {evaluated:0,opened:0,resolved:0};
 const q=scope.map(()=>'?').join(','),id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO contract_workflow_runs(id,actor_id,countries) VALUES(?,?,?)').bind(id,actorId,JSON.stringify(scope)).run();
 try{
 const contracts=(await env.DB.prepare("SELECT k.*,c.country_code FROM managed_contracts k JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND c.country_code IN ("+q+')').bind(...scope).all()).results;
 const entries=(await env.DB.prepare("SELECT e.* FROM contract_entries e JOIN managed_contracts k ON k.id=e.contract_id JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND c.country_code IN ("+q+')').bind(...scope).all()).results;
 const usage=(await env.DB.prepare("SELECT t.sla_entry_id,SUM(t.hours_units) hours_units FROM sla_time_entries t JOIN managed_contracts k ON k.id=t.contract_id JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND t.status='recorded' AND c.country_code IN ("+q+') GROUP BY t.sla_entry_id').bind(...scope).all()).results;
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Indian/Mauritius'}),desired=planContractAlerts(contracts,entries,today,usage),keys=new Set(desired.map(a=>a.rule+'|'+a.entity_id));
 const existing=(await env.DB.prepare("SELECT a.*,l.contract_id,l.entry_id,l.due_date FROM workflow_alerts a JOIN contract_alert_links l ON l.alert_id=a.id JOIN managed_contracts k ON k.id=l.contract_id JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND c.country_code IN ("+q+')').bind(...scope).all()).results;
 const event=(a,type)=>env.DB.prepare('INSERT INTO contract_workflow_events(id,contract_id,country_code,actor_id,event_type,rule,details) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),a.contract_id,a.country_code,actorId,type,a.rule,JSON.stringify({entity_id:a.entity_id,due_date:a.due_date,severity:a.severity}));
 let opened=0,resolved=0;
 for(const a of desired){const old=existing.find(x=>x.rule===a.rule&&x.entity_id===a.entity_id),reopen=old&&(old.status==='resolved'||old.due_date!==a.due_date||old.country_code!==a.country_code||(a.rule==='contract_sla_hours_exhausted'&&old.severity!==a.severity)),alertId=old?.id||crypto.randomUUID();
 if(!old){const r=await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO workflow_alerts(id,rule,entity_type,entity_id,country_code,message,severity) VALUES(?,?,'contract',?,?,?,?)").bind(alertId,a.rule,a.entity_id,a.country_code,a.message,a.severity),env.DB.prepare('INSERT OR IGNORE INTO contract_alert_links(alert_id,contract_id,entry_id,due_date) SELECT id,?,?,? FROM workflow_alerts WHERE rule=? AND entity_type=\'contract\' AND entity_id=?').bind(a.contract_id,a.entry_id,a.due_date,a.rule,a.entity_id)]);if(r[0].meta?.changes){opened++;await event(a,'alert_opened').run();}}
 else {const changes=[env.DB.prepare('UPDATE workflow_alerts SET country_code=?,message=?,severity=? WHERE id=?').bind(a.country_code,a.message,a.severity,alertId),env.DB.prepare('UPDATE contract_alert_links SET due_date=? WHERE alert_id=?').bind(a.due_date,alertId)];if(reopen){changes.push(env.DB.prepare("UPDATE workflow_alerts SET status='open',acknowledged_by=NULL,acknowledged_at=NULL WHERE id=?").bind(alertId),env.DB.prepare("UPDATE notification_outbox SET status='cancelled' WHERE alert_id=? AND channel='in_app'").bind(alertId),event(a,'alert_reopened'));opened++;}await env.DB.batch(changes);}
 }
 for(const a of existing)if(!keys.has(a.rule+'|'+a.entity_id)&&a.status!=='resolved'){await env.DB.batch([env.DB.prepare("UPDATE workflow_alerts SET status='resolved' WHERE id=?").bind(a.id),env.DB.prepare("UPDATE notification_outbox SET status='cancelled' WHERE alert_id=? AND channel='in_app'").bind(a.id),event(a,'alert_resolved')]);resolved++;}
 // This module delivers in-app notifications only. Email is intentionally not queued.
 const open=(await env.DB.prepare("SELECT a.id,a.country_code,a.rule,a.entity_id,l.contract_id FROM workflow_alerts a JOIN contract_alert_links l ON l.alert_id=a.id JOIN managed_contracts k ON k.id=l.contract_id JOIN customers c ON c.id=k.customer_id WHERE a.status='open' AND c.organization_id='hmt' AND c.country_code IN ("+q+')').bind(...scope).all()).results;
 for(const a of open){const recipients=(await env.DB.prepare("SELECT DISTINCT u.id FROM users u WHERE u.organization_id='hmt' AND u.account_status='active' AND NOT EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='requester') AND (EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role IN ('super_admin','admin')) OR EXISTS(SELECT 1 FROM country_leads l WHERE l.user_id=u.id AND l.country_code=?))").bind(a.country_code).all()).results;
 for(const u of recipients)await env.DB.prepare("INSERT INTO notification_outbox(id,alert_id,recipient_id,channel,status,sent_at) VALUES(?,?,?,'in_app','sent',CURRENT_TIMESTAMP) ON CONFLICT(alert_id,recipient_id,channel) DO UPDATE SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE notification_outbox.status='cancelled'").bind(crypto.randomUUID(),a.id,u.id).run();
 // Cancel delivery to recipients whose access has subsequently changed.
 await env.DB.prepare("UPDATE notification_outbox SET status='cancelled' WHERE alert_id=? AND channel='in_app' AND recipient_id NOT IN (SELECT u.id FROM users u WHERE u.organization_id='hmt' AND u.account_status='active' AND NOT EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='requester') AND (EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role IN ('super_admin','admin')) OR EXISTS(SELECT 1 FROM country_leads l WHERE l.user_id=u.id AND l.country_code=?)))").bind(a.id,a.country_code).run();
 }
 await env.DB.prepare("UPDATE contract_workflow_runs SET status='completed',finished_at=CURRENT_TIMESTAMP,evaluated=?,opened=?,resolved=? WHERE id=?").bind(contracts.length,opened,resolved,id).run();return {id,evaluated:contracts.length,opened,resolved};
 }catch(e){await env.DB.prepare("UPDATE contract_workflow_runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error='Workflow scan failed; inspect Worker logs' WHERE id=?").bind(id).run();throw e;}
}
export async function contractWorkflowRoute(request,env,url){
 const user=await sessionUser(request,env);if(!user)return response({error:'Sign in required'},401);const rr=await roles(env,user.id);if(rr.includes('requester')||!rr.some(r=>['super_admin','admin','country_lead','regional_manager','group_leader','technician'].includes(r)))return response({error:'Internal account required'},403);
 const global=rr.some(r=>['super_admin','admin'].includes(r)),write=global||rr.includes('country_lead'),scope=global?countries:rr.includes('country_lead')?(await env.DB.prepare('SELECT country_code FROM country_leads WHERE user_id=?').bind(user.id).all()).results.map(x=>x.country_code).filter(c=>countries.includes(c)):[user.country_code].filter(c=>countries.includes(c));if(!scope.length)return response({error:'No country access'},403);
 const q=scope.map(()=>'?').join(','),contract=url.searchParams.get('contract_id')||'';
 if(request.method==='GET'&&url.pathname==='/api/contract-workflows'){
 const items=(await env.DB.prepare("SELECT a.id,a.rule,a.message,a.severity,a.status,a.country_code,a.created_at,a.acknowledged_at,l.contract_id,l.entry_id,l.due_date,k.reference,k.title,c.name organization_name FROM workflow_alerts a JOIN contract_alert_links l ON l.alert_id=a.id JOIN managed_contracts k ON k.id=l.contract_id JOIN customers c ON c.id=k.customer_id WHERE c.organization_id='hmt' AND c.country_code IN ("+q+") AND (?='' OR k.id=?) ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,l.due_date LIMIT 1000").bind(...scope,contract,contract).all()).results;
 const runs=(await env.DB.prepare("SELECT id,started_at,finished_at,status,evaluated,opened,resolved,error FROM contract_workflow_runs WHERE "+(global?'1=1':'actor_id=?')+' ORDER BY started_at DESC LIMIT 10').bind(...(global?[]:[user.id])).all()).results;
 return response({items,runs,rules:workflowRules,can_write:write,schedule:'Daily at 08:00 Mauritius time',channel:'in_app'});
 }
 if(request.method!=='POST')return response({error:'Not found'},404);if(request.headers.get('origin')!==url.origin)return response({error:'Invalid origin'},403);if(!write)return response({error:'Administrator or assigned country lead required'},403);
 if(url.pathname==='/api/contract-workflows/scan')return response({ok:true,...await scanContractWorkflows(env,{scope,actorId:user.id})});
 if(url.pathname==='/api/contract-workflows/acknowledge'){
 let d;try{d=await request.json()}catch{return response({error:'Invalid request'},400)}
 const a=await env.DB.prepare("SELECT a.*,l.contract_id,l.due_date FROM workflow_alerts a JOIN contract_alert_links l ON l.alert_id=a.id JOIN managed_contracts k ON k.id=l.contract_id JOIN customers c ON c.id=k.customer_id WHERE a.id=? AND c.organization_id='hmt' AND c.country_code IN ("+q+')').bind(String(d.id||''),...scope).first();if(!a)return response({error:'Alert unavailable'},403);if(a.status!=='open')return response({error:'Only open alerts can be acknowledged'},409);
 await env.DB.batch([env.DB.prepare("UPDATE workflow_alerts SET status='acknowledged',acknowledged_by=?,acknowledged_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'").bind(user.id,a.id),env.DB.prepare('INSERT INTO contract_workflow_events(id,contract_id,country_code,actor_id,event_type,rule,details) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),a.contract_id,a.country_code,user.id,'alert_acknowledged',a.rule,JSON.stringify({alert_id:a.id,due_date:a.due_date}))]);return response({ok:true});
 }return response({error:'Not found'},404);
}
