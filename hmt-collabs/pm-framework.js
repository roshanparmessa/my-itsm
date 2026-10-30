export const stages=['initiation','planning','delivery','transition','closure','closed'];
export const domains=['Governance','Scope','Schedule','Finance','Stakeholders','Resources','Risk'];
const c=(code,stage,domain,title,criteria,itil='')=>({code,stage,domain,title,criteria,itil});
export const controls=[
 c('business_case','initiation','Governance','Business case & value','Document the problem, expected benefits, success measures, options and sustainability considerations.'),
 c('charter','initiation','Governance','Project charter & authority','Identify sponsor, project manager, objectives, boundaries, delivery approach and decision authority.'),
 c('stakeholders','initiation','Stakeholders','Stakeholder identification','Record customer, delivery and service stakeholders, responsibilities and engagement needs.','Relationship management'),
 c('scope','planning','Scope','Scope & acceptance baseline','Define deliverables, exclusions, WBS and measurable customer acceptance criteria.'),
 c('schedule','planning','Schedule','Schedule & dependencies baseline','Plan tasks, milestone dates, dependency sequencing and accountable owners.'),
 c('budget','planning','Finance','Budget & hours baseline','Approve the project currency, cost budget, planned effort and any allocated support hours.'),
 c('resources','planning','Resources','Resource & responsibility plan','Assign delivery roles, capacity, skills, deputies and a communication cadence.'),
 c('risk','planning','Risk','Risk & issue plan','Record threats, opportunities, likelihood, impact, responses, owners and review dates.','Risk management'),
 c('quality','planning','Scope','Quality & validation plan','Define test evidence, review roles, defect criteria and acceptance methods.','Service validation and testing'),
 c('procurement','planning','Resources','Supplier & procurement plan','Record suppliers, procurement dependencies and commitments, or justify non-applicability.','Supplier management'),
 c('change_plan','planning','Governance','Change & release strategy','Define change authority, impact assessment, change windows and rollback requirements.','Change enablement'),
 c('change_authority','delivery','Governance','Production change authorization','Reference authorized changes, risk decisions, implementation window and rollback approval.','Change enablement'),
 c('validation','delivery','Scope','Validation & test evidence','Attach test results and evidence that acceptance conditions and release criteria are met.','Service validation and testing'),
 c('release','delivery','Schedule','Release & deployment readiness','Document deployment steps, communications, rollback tests and readiness decisions.','Release and deployment management'),
 c('handover','transition','Resources','Operational handover','Identify support owner, support procedures, escalation paths and operational acceptance.','Service level management'),
 c('configuration','transition','Scope','Configuration & asset handover','Reference installed configuration, hardware serial numbers, licenses, warranties and inventory evidence.','Service configuration management'),
 c('knowledge','transition','Stakeholders','Knowledge & training','Provide runbooks, knowledge references, training evidence and support contacts.','Knowledge management'),
 c('service_acceptance','transition','Governance','Service acceptance','Confirm monitoring, continuity, security, support coverage and known-error ownership.','Service level management'),
 c('customer_acceptance','closure','Scope','Customer acceptance','Record customer sign-off evidence and treatment of any outstanding conditions.'),
 c('financial_close','closure','Finance','Financial & procurement closure','Reconcile recorded project costs, outstanding commitments and hours; reference financial evidence.'),
 c('lessons','closure','Governance','Lessons & improvement','Record outcomes, lessons, improvement owners and follow-up actions.','Continual improvement'),
 c('benefits','closure','Governance','Benefits ownership & review','Assign post-project benefit measures, owners and review dates.','Continual improvement')
];
export const recordFields={
 risk:['name','owner_id','probability','impact','response','due_date','status','notes'],issue:['name','owner_id','priority','due_date','status','notes'],
 change:['name','reason','impact_analysis','proposed_scope','proposed_budget','proposed_end_date','evidence','status'],
 milestone:['name','owner_id','due_date','acceptance','status','evidence'],stakeholder:['name','organization','contact_id','user_id','responsibility','engagement','notes'],
 procurement:['name','supplier_id','owner_id','due_date','status','reference','evidence','notes'],quality:['name','owner_id','criteria','result','evidence','status'],
 handover:['name','owner_id','support_group','runbook','rollback','evidence','status'],lesson:['name','owner_id','finding','action','due_date','status'],
 cost:['name','cost_type','amount','date','reference','evidence','notes'],benefit:['name','owner_id','measure','target','due_date','status','evidence']
};
export const framework={basis:'PMBOK Eighth Edition domains and ITIL practice-aligned controls',domains,stages,controls,references:[{title:'PMI PMBOK Guide',url:'https://www.pmi.org/standards/pmbok'},{title:'PeopleCert ITIL practice guidance',url:'https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/itil-practice-manager'}],notice:'Organization-tailored readiness controls. Evidence and approvals support governance; they do not certify ITIL/PMBOK conformance or legal compliance.'};
export function gateReadiness(p,checks,tasks,records,time=[]){const through=stages.indexOf(p.stage),missing=controls.filter(c=>stages.indexOf(c.stage)<=through).filter(c=>{const x=checks.find(r=>r.code===c.code);return !x||!(x.status==='evidenced'&&x.owner_id&&x.evidence&&x.notes||x.status==='not_applicable'&&x.notes.length>=20);}).map(c=>c.title);
 if(!p.manager_id||!p.sponsor_id||p.manager_id===p.sponsor_id)missing.push('Independent sponsor and project manager');
 if(through>=1){const d=JSON.parse(p.data||'{}');if(!d.scope||!d.start_date||!d.end_date||d.budget==='')missing.push('Scope, dates and budget baseline');if(!tasks.length||tasks.some(t=>!t.assignee_id||!t.due_date||!JSON.parse(t.pm_data||t.data||'{}').start_date))missing.push('WBS tasks with start date, end date and assigned owner');}
 if(through>=2&&records.some(r=>r.kind==='change'&&JSON.parse(r.data).status==='submitted'))missing.push('Pending change decisions');
 if(through>=3&&records.some(r=>r.kind==='issue'&&JSON.parse(r.data).status!=='closed'&&JSON.parse(r.data).priority==='critical'))missing.push('Open critical issues');
 if(through>=4&&time.some(t=>t.status==='submitted'))missing.push('Unreviewed project time entries');
 if(through>=4&&tasks.some(t=>!['done','cancelled'].includes(t.status)))missing.push('Incomplete project tasks');
 return {ready:missing.length===0,missing,required:controls.filter(c=>stages.indexOf(c.stage)<=through).length};}
export function dependencyCycle(taskId,deps,links){const graph=new Map(links.map(x=>[x.task_id,JSON.parse(x.data||'{}').dependencies||[]]));graph.set(taskId,deps);const visiting=new Set(),done=new Set();function visit(id){if(visiting.has(id))return true;if(done.has(id))return false;visiting.add(id);for(const d of graph.get(id)||[])if(visit(d))return true;visiting.delete(id);done.add(id);return false;}return visit(taskId);}
