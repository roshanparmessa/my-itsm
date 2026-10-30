const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function awardForProject(env,a,d,customer){
 if(!d.award_id)return null;
 const award=await env.DB.prepare('SELECT * FROM commercial_awards WHERE id=? AND customer_id=?').bind(d.award_id,customer).first();
 if(!award)throw fail('Award unavailable',403);
 if(typeof d.workstream!=='string'||!d.workstream.trim()||d.workstream.length>100)throw fail('Workstream reference is required');
 const old=await env.DB.prepare('SELECT project_id FROM commercial_handovers WHERE award_id=? AND workstream=?').bind(award.id,d.workstream.trim()).first();
 if(old)throw fail('This award workstream already has a project',409);
 return award;
}
export function handoverStatements(env,{award,projectId,workstream,userId}){
 const snapshot=JSON.parse(award.snapshot),id=crypto.randomUUID();
 return [env.DB.prepare('INSERT INTO commercial_handovers(id,award_id,project_id,workstream,requested_by) VALUES(?,?,?,?,?)').bind(id,award.id,projectId,workstream.trim(),userId),
 ...snapshot.sources.map(s=>env.DB.prepare("INSERT OR IGNORE INTO pm_links(id,project_id,source_type,source_id) VALUES(?,?,'commercial',?)").bind(crypto.randomUUID(),projectId,s.id)),
 env.DB.prepare("INSERT INTO pm_records(id,project_id,kind,data,created_by) VALUES(?,?,'handover',?,?)").bind(id,projectId,JSON.stringify({name:'Commercial delivery acceptance: '+award.reference,status:'open',owner_id:snapshot.manager_id,acceptance:'Review accepted scope, resources, risks, dependencies and baseline before delivery.',evidence:award.evidence,commercial_handover_id:id}),userId),
 env.DB.prepare('INSERT INTO commercial_delivery_audit(id,customer_id,award_id,actor_id,action,snapshot) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),award.customer_id,award.id,userId,'Draft project created from award',JSON.stringify({project_id:projectId,workstream,accepted_snapshot:snapshot}))];
}
export async function pendingCommercialHandover(env,projectId){return env.DB.prepare("SELECT 1 FROM commercial_handovers WHERE project_id=? AND status<>'accepted' LIMIT 1").bind(projectId).first();}
