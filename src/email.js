const TEST_RECIPIENT='roshan.parmessa@gmail.com';
export async function sendTestEmail(env,{subject,text}){
 const apiKey=env['HMT-Collabs-Testing']||env.RESEND_API_KEY;
 if(!apiKey)return {ok:false,error:'Email provider secret unavailable'};
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({from:'HMT Collabs <onboarding@resend.dev>',to:[TEST_RECIPIENT],subject,text})});
 const result=await response.json().catch(()=>({}));
 return response.ok?{ok:true,id:result.id}:{ok:false,error:'Resend rejected the test message',status:response.status,provider_code:result.name||result.error?.name||null};
}
export async function emailRoute(request,env,url,sessionUser,roles){
 if(url.pathname!=='/api/admin/email-test')return null;
 if(request.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{'content-type':'application/json'}});
 if(request.headers.get('origin')!==url.origin)return new Response(JSON.stringify({error:'Invalid origin'}),{status:403,headers:{'content-type':'application/json'}});
 const user=await sessionUser(request,env);
 if(!user)return new Response(JSON.stringify({error:'Authentication required'}),{status:401,headers:{'content-type':'application/json'}});
 const assigned=await roles(env,user.id);
 if(!assigned.some(r=>['super_admin','admin'].includes(r)))return new Response(JSON.stringify({error:'Forbidden'}),{status:403,headers:{'content-type':'application/json'}});
 const result=await sendTestEmail(env,{subject:'HMT Collabs — email configuration test',text:'This is a test email from HMT Collabs. No customer activation or account changes have been performed.'});
 return new Response(JSON.stringify(result),{status:result.ok?200:502,headers:{'content-type':'application/json','cache-control':'no-store'}});
}
