import {sessionUser,roles} from './auth.js';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const C=['MU','MG','RW','BI'];
export async function forecastRoute(request,env,url){
 const user=await sessionUser(request,env);if(!user)return reply({error:'Authentication required'},401);
 const rr=await roles(env,user.id);if(rr.includes('requester'))return reply({error:'Forbidden'},403);
 const editor=rr.includes('super_admin');
 const countries=rr.some(r=>['super_admin','admin'].includes(r))?C:rr.includes('country_lead')?(await env.DB.prepare('SELECT country_code FROM country_leads WHERE user_id=?').bind(user.id).all()).results.map(x=>x.country_code):[user.country_code].filter(x=>C.includes(x));
 if(!countries.length)return reply({error:'No authorized countries'},403);
 const year=String(url.searchParams.get('year')||new Date().getUTCFullYear());if(!/^20\d{2}$/.test(year))return reply({error:'Invalid financial year'},400);
 if(request.method==='GET'){
  const q=countries.map(()=>'?').join(',');
  const targets=await env.DB.prepare('SELECT id,financial_year,country_code,currency,target_amount,updated_at FROM regional_forecast_targets WHERE financial_year=? AND country_code IN ('+q+') ORDER BY country_code,currency').bind(year,...countries).all();
  const pipeline=await env.DB.prepare("SELECT a.country_code,f.currency,COUNT(*) opportunities,SUM(CASE WHEN a.workflow_status='won' THEN f.amount ELSE 0 END) won_amount,SUM(CASE WHEN a.workflow_status NOT IN ('won','lost','cancelled') THEN f.amount ELSE 0 END) open_amount,SUM(CASE WHEN a.workflow_status NOT IN ('won','lost','cancelled') THEN f.amount*f.probability/100.0 ELSE 0 END) weighted_amount FROM regional_activities a JOIN regional_activity_financials f ON f.activity_id=a.id WHERE a.section='financial' AND a.country_code IN ("+q+") AND substr(COALESCE(f.expected_close,a.due_date),1,4)=? GROUP BY a.country_code,f.currency ORDER BY a.country_code,f.currency").bind(...countries,year).all();
  const detail=await env.DB.prepare("SELECT a.id,a.title,a.workflow_type,a.workflow_status,a.country_code,c.name customer,f.reference,f.amount,f.currency,f.probability,f.expected_close FROM regional_activities a JOIN regional_activity_financials f ON f.activity_id=a.id LEFT JOIN customers c ON c.id=a.customer_id WHERE a.section='financial' AND a.country_code IN ("+q+") AND substr(COALESCE(f.expected_close,a.due_date),1,4)=? ORDER BY f.expected_close LIMIT 300").bind(...countries,year).all();
  return reply({year,countries,targets:targets.results,pipeline:pipeline.results,detail:detail.results,can_edit:editor,rule:'Calendar-year reporting; amounts are not aggregated across currencies. Weighted pipeline = open amount × probability / 100. Targets are maintained by authorized CIO administrators.'});
 }
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==url.origin)return reply({error:'Invalid origin'},403);
 if(!editor)return reply({error:'CIO forecast administration requires super_admin role'},403);
 let data;try{data=await request.json()}catch{return reply({error:'Invalid JSON'},400)}
 if(url.pathname!=='/api/forecast/targets')return reply({error:'Not found'},404);
 const country=String(data.country_code||''),currency=String(data.currency||'').toUpperCase(),amount=Number(data.target_amount);
 if(!countries.includes(country)||!['MUR','USD','EUR','MGA','BIF','RWF'].includes(currency)||!Number.isFinite(amount)||amount<0||amount>1e15)return reply({error:'Invalid target country, currency or amount'},400);
 const previous=await env.DB.prepare('SELECT id,target_amount FROM regional_forecast_targets WHERE financial_year=? AND country_code=? AND currency=?').bind(year,country,currency).first();
 const id=previous?.id||crypto.randomUUID();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO regional_forecast_targets(id,financial_year,country_code,currency,target_amount,created_by,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(financial_year,country_code,currency) DO UPDATE SET target_amount=excluded.target_amount,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP').bind(id,year,country,currency,amount,user.id,user.id),
  env.DB.prepare('INSERT INTO regional_forecast_audit(id,target_id,actor_id,previous_amount,new_amount) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,user.id,previous?.target_amount??null,amount)
 ]);
 return reply({ok:true,id});
}
