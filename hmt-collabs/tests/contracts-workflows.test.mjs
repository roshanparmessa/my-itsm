import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';


import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
process.chdir(dirname(fileURLToPath(import.meta.url)));
const fixture=mkdtempSync(join(tmpdir(),'hmt-contract-tests-'));
writeFileSync(join(fixture,'auth.mjs'),`export async function sessionUser(r,env){return env.testUser} export async function roles(env){return env.testRoles}`);
for(const name of ['intelligence','contract-automation','contracts'])writeFileSync(join(fixture,name+'.mjs'),readFileSync('../'+name+'.js','utf8').replaceAll("'./auth.js'","'./auth.mjs'").replaceAll("'./contract-automation.js'","'./contract-automation.mjs'"));
const {intelligenceRoute,reportCatalog}=await import(pathToFileURL(join(fixture,'intelligence.mjs')));
const {planContractAlerts,scanContractWorkflows,contractWorkflowRoute}=await import(pathToFileURL(join(fixture,'contract-automation.mjs')));

const db=new DatabaseSync(':memory:');db.exec(readFileSync('schema.sql','utf8'));db.exec(readFileSync('../migrations/contract-workflows.sql','utf8'));
db.exec("INSERT INTO organizations(id,name) VALUES('hmt','HMT'); INSERT INTO countries(code,name,currency) VALUES('MU','Mauritius','MUR'),('MG','Madagascar','MGA'); INSERT INTO customers(id,organization_id,name,country_code) VALUES('mu','hmt','MU customer','MU'),('mg','hmt','MG supplier','MG'); INSERT INTO users(id,organization_id,email,display_name,role,country_code,account_status) VALUES('u','hmt','lead@example.com','Lead','admin','MU','active'),('v','hmt','mg@example.com','Other','admin','MG','active'); INSERT INTO country_leads VALUES('MU','u'),('MG','v'); INSERT INTO user_roles VALUES('u','country_lead'),('v','country_lead');");
const DB={prepare(sql){return {params:[],bind(...p){this.params=p;return this},async all(){const results=db.prepare(sql).all(...this.params);return {results,meta:{changes:Number(db.prepare('SELECT changes() n').get().n)}}},async first(){return db.prepare(sql).get(...this.params)||null},async run(){const x=db.prepare(sql).run(...this.params);return {meta:{changes:Number(x.changes)}}}}},async batch(stmts){db.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.all());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}};
const env={DB,testUser:{id:'u',country_code:'MU',display_name:'Lead'},testRoles:['admin']};
async function report(id,query=''){const r=new Request('https://test.example/api/intelligence/report?year=2026&report='+id+query);const out=await intelligenceRoute(r,env,new URL(r.url));const j=await out.json();assert.equal(out.status,200,JSON.stringify(j));return j;}
for(const r of reportCatalog)await report(r.id);console.log('All '+reportCatalog.length+' report queries executed against the current production schema.');
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Indian/Mauritius'}),date=d=>new Date(Date.parse(today+'T00:00:00Z')+d*86400000).toISOString().slice(0,10);
const c={id:'c',customer_id:'mu',reference:'C-001',title:'Support',contract_type:'support',status:'active',start_date:date(-100),end_date:date(20),currency:'MUR',amount:'1000',data:JSON.stringify({notice_days:'30',auto_renew:'yes',owner:''}),country_code:'MU'};
db.prepare('INSERT INTO managed_contracts(id,customer_id,reference,title,contract_type,status,start_date,end_date,currency,amount,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...['id','customer_id','reference','title','contract_type','status','start_date','end_date','currency','amount','data'].map(k=>c[k]));
const e=(id,kind,data)=>db.prepare('INSERT INTO contract_entries(id,contract_id,kind,data) VALUES(?,?,?,?)').run(id,'c',kind,JSON.stringify(data));
e('ob','obligation',{name:'Quarterly report',status:'pending',due_date:date(-2)});e('rn','renewal',{name:'Renewal',stage:'quotation_sent',follow_up_date:date(-1),quoted_amount:'1200',currency:'MUR'});e('cv','coverage',{name:'Warranty',coverage_end:date(15)});e('doc','document',{name:'Authorization',expiry_date:date(-2)});
const first=await scanContractWorkflows(env,{scope:['MU'],actorId:'u'});assert.equal(first.opened,7);assert.equal(db.prepare('SELECT count(*) n FROM contract_workflow_events').get().n,7);assert.equal(db.prepare("SELECT count(*) n FROM notification_outbox WHERE channel='email'").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM notification_outbox WHERE recipient_id='v'").get().n,0);
assert.equal((await scanContractWorkflows(env,{scope:['MU']})).opened,0);assert.equal(db.prepare('SELECT count(*) n FROM workflow_alerts').get().n,7);
const alert=db.prepare("SELECT id FROM workflow_alerts WHERE rule='contract_obligation'").get();
async function api(path,data,origin='https://test.example'){const r=new Request('https://test.example'+path,data?{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)}:{});const x=await contractWorkflowRoute(r,env,new URL(r.url));return {status:x.status,data:await x.json()}}
assert.equal((await api('/api/contract-workflows/acknowledge',{id:alert.id})).status,200);await scanContractWorkflows(env,{scope:['MU']});assert.equal(db.prepare('SELECT status FROM workflow_alerts WHERE id=?').get(alert.id).status,'acknowledged');
db.prepare('UPDATE contract_entries SET data=? WHERE id=?').run(JSON.stringify({name:'Quarterly report',status:'completed',due_date:date(-2)}),'ob');assert.equal((await scanContractWorkflows(env,{scope:['MU']})).resolved,1);assert.equal(db.prepare('SELECT status FROM workflow_alerts WHERE id=?').get(alert.id).status,'resolved');
db.prepare('UPDATE contract_entries SET data=? WHERE id=?').run(JSON.stringify({name:'Quarterly report',status:'pending',due_date:date(-2)}),'ob');assert.equal((await scanContractWorkflows(env,{scope:['MU']})).opened,1);
assert.equal((await api('/api/contract-workflows/scan',{},'https://evil.example')).status,403);env.testRoles=['technician'];assert.equal((await api('/api/contract-workflows/scan',{})).status,403);env.testUser.country_code='MG';assert.equal((await api('/api/contract-workflows')).data.items.length,0);env.testRoles=['requester','admin'];assert.equal((await api('/api/contract-workflows')).status,403);
env.testRoles=['admin'];env.testUser.country_code='MU';const financial=await report('contract-values');assert.equal(financial.sections[0].rows[0].recorded_total_value,1000);const audit=await report('contract-audit');assert(audit.sections[1].rows.length>0);
env.testRoles=['technician'];const r=new Request('https://test.example/api/intelligence/report?report=contract-values');assert.equal((await intelligenceRoute(r,env,new URL(r.url))).status,403);
assert.equal(planContractAlerts([{...c,status:'archived'}],[],today).length,0);assert(planContractAlerts([{...c,end_date:date(-1)}],[],today).some(a=>a.rule==='contract_expired'));assert(planContractAlerts([{...c,end_date:date(65)}],[],today).some(a=>a.rule==='contract_expiry_90'));
for(const name of ['contracts','reporting']){const source=readFileSync('../'+(name==='contracts'?'contracts-page.html':'reporting-ui.js'),'utf8');const html=name==='contracts'?source:JSON.parse(source.slice(source.indexOf('=')+1).trim().replace(/;$/,''));writeFileSync(join(fixture,name+'-inline.mjs'),html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);}
console.log('Passed workflow creation, repeat-scan deduplication, in-app delivery, country isolation, acknowledgement, resolution, reopening, role/Origin restrictions and report permissions.');
const {contractsRoute}=await import(pathToFileURL(join(fixture,'contracts.mjs')));env.testRoles=['admin'];
async function saveContract(path,data){const req=new Request('https://test.example'+path,{method:'POST',headers:{origin:'https://test.example','content-type':'application/json'},body:JSON.stringify(data)});const r=await contractsRoute(req,env,new URL(req.url));const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;}
const saved=await saveContract('/api/contracts/save',{customer_id:'mu',reference:'C-002',title:'Save workflow test',contract_type:'support',status:'active',start_date:date(-100),end_date:date(12),currency:'MUR',amount:'1500',auto_renew:'no',notice_days:'0'});
assert(db.prepare("SELECT count(*) n FROM workflow_alerts WHERE entity_id=?").get(saved.id).n>0);
await saveContract('/api/contracts/entry',{contract_id:saved.id,kind:'obligation',name:'Test deliverable',due_date:date(-1),status:'pending'});
assert(db.prepare("SELECT count(*) n FROM contract_workflow_runs WHERE actor_id='u'").get().n>=3);
console.log('Contract and child-record saves trigger workflow recalculation successfully.');
