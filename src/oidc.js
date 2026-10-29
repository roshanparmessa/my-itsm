// OpenID Connect utilities for Microsoft Entra ID.
const enc=new TextEncoder();
export function toBase64Url(buffer){return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function fromBase64Url(value){const normalized=value.replaceAll('-','+').replaceAll('_','/');return Uint8Array.from(atob(normalized),c=>c.charCodeAt(0));}
export function newChallenge(){return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));}
export async function sha256(value){return toBase64Url(await crypto.subtle.digest('SHA-256',enc.encode(value)));}
export async function verifyMicrosoftIdToken(token,settings,expectedNonce){
 if(typeof token!=='string')throw Error('Missing ID token');
 const parts=token.split('.');
 if(parts.length!==3)throw Error('Malformed ID token');
 const header=JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
 const claims=JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!==settings.issuer||claims.aud!==settings.client_id||claims.tid!==settings.tenant_id||typeof claims.sub!=='string'||!claims.sub||claims.nonce!==expectedNonce||typeof claims.exp!=='number'||claims.exp<=now||typeof claims.nbf==='number'&&claims.nbf>now+60||typeof claims.iat!=='number'||claims.iat>now+60)throw Error('Invalid ID token claims');
 const endpoint='https://login.microsoftonline.com/'+settings.tenant_id+'/discovery/v2.0/keys';
 const response=await fetch(endpoint);
 if(!response.ok)throw Error('Signing keys unavailable');
 const body=await response.json();
 const jwk=body.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
 if(!jwk)throw Error('Signing key not found');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,fromBase64Url(parts[2]),enc.encode(parts[0]+'.'+parts[1]));
 if(!valid)throw Error('Invalid ID token signature');
 return claims;
}
