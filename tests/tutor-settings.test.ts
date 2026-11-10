import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { HttpError, sameOrigin } from '../lib/http-server.ts';
import { settingsHandlers } from '../lib/tutor-settings-server.ts';
import { SESSION_COOKIE, SESSION_TTL, TutorSessions, connectionStatus, resolveCredential } from '../lib/tutor-sessions.ts';
import { credentialFromInput, generateTutor, verifyCredential } from '../lib/tutor-provider.ts';
import { buildLesson, type TutorEvidence } from '../lib/teaching.ts';
import { tutorReply } from '../lib/tutor-server.ts';

const dummy='test-only-not-a-real-api-key';
const credential={key:dummy,provider:'openai' as const,model:'gpt-4.1-mini'};
const endpoint='http://localhost/api/tutor/settings';
const req=(method:string,body?:unknown,cookie?:string,origin='http://localhost')=>new Request(endpoint,{method,headers:{origin,...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
function fixture():TutorEvidence{const game=new Chess();game.move('f3');game.move('e5');return {fen:game.fen(),uci:'g2g4',best:{score:{kind:'cp',value:-100},pv:['g2g3','d7d5']},played:{score:{kind:'mate',winner:'b',moves:1},pv:['g2g4','d8h4']}};}
const text={title:'先保護國王',why:['示範線中對方以 Qh4# 將死國王。'],better:'比較建議走法與對方的回應。',takeaway:'落子前先檢查將軍。',factIds:['reply']};

test('personal keys never enter status JSON; session cookies are opaque, and different browsers are isolated',async()=>{
 const sessions=new TutorSessions();let verified=0;const handlers=settingsHandlers({sessions,site:()=>null,verify:async c=>{verified++;assert.equal(c.key,dummy);}});
 const response=await handlers.POST(req('POST',credential));assert.equal(response.status,200);assert.equal(verified,1);
 const json=await response.json();assert.equal(json.source,'personal');assert.ok(!JSON.stringify(json).includes(dummy));
 const setCookie=response.headers.get('set-cookie')!;assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Max-Age=3600/);assert.ok(!setCookie.includes(dummy));
 const cookie=setCookie.split(';')[0];assert.equal((await handlers.GET(req('GET',undefined,cookie)).json()).available,true);
 assert.equal((await handlers.GET(req('GET')).json()).available,false);
 const current=resolveCredential(req('GET',undefined,cookie),sessions,null);assert.equal(current.credential?.key,dummy);sessions.remove(cookie.split('=')[1]);
});

test('failed key replacement preserves the working key; successful replacement invalidates the old token',async()=>{
 const sessions=new TutorSessions();let fail=false;
 const handlers=settingsHandlers({sessions,site:()=>null,verify:async()=>{if(fail)throw new HttpError(400,'金鑰無效');}});
 const first=await handlers.POST(req('POST',credential));const cookie=first.headers.get('set-cookie')!.split(';')[0];
 fail=true;const bad=await handlers.POST(req('POST',{...credential,key:'test-only-rejected-key'},cookie));assert.equal(bad.status,400);assert.equal(resolveCredential(req('GET',undefined,cookie),sessions,null).credential?.key,dummy);
 fail=false;const next=await handlers.POST(req('POST',{key:'test-only-gemini-key',provider:'gemini',model:'gemini-3.8-flash'},cookie));
 const nextCookie=next.headers.get('set-cookie')!.split(';')[0];assert.equal(resolveCredential(req('GET',undefined,cookie),sessions,null).credential,null);assert.equal(resolveCredential(req('GET',undefined,nextCookie),sessions,null).credential?.provider,'gemini');
 await handlers.DELETE(req('DELETE',undefined,nextCookie));
});

test('sessions expire and removal reverts to site configuration without exposing either key',async()=>{
 let now=1000;const sessions=new TutorSessions(()=>now);const personal=sessions.create(credential);const cookie=`${SESSION_COOKIE}=${personal.token}`;
 const site={key:'test-only-site-key',provider:'gemini' as const,model:'gemini-3.8-flash'};
 assert.equal(connectionStatus(req('GET',undefined,cookie),sessions,site).source,'personal');now+=SESSION_TTL;
 assert.equal(connectionStatus(req('GET',undefined,cookie),sessions,site).source,'site');assert.equal(sessions.get(personal.token),null);
 const fresh=sessions.create(credential);const handlers=settingsHandlers({sessions,site:()=>site,verify:async()=>{}});
 const removed=await handlers.DELETE(req('DELETE',undefined,`${SESSION_COOKIE}=${fresh.token}`));const data=await removed.json();assert.equal(data.source,'site');assert.match(removed.headers.get('set-cookie')!,/Max-Age=0/);assert.ok(!JSON.stringify(data).includes('test-only'));
});

test('settings reject cross-origin, insecure public and oversized requests without calling the provider',async()=>{
 let calls=0;const handlers=settingsHandlers({sessions:new TutorSessions(),site:()=>null,verify:async()=>{calls++;}});
 assert.equal((await handlers.POST(req('POST',credential,undefined,'https://attacker.example'))).status,403);
 assert.equal((await handlers.DELETE(req('DELETE',undefined,undefined,'https://attacker.example'))).status,403);
 const insecure=new Request('http://public.example/api/tutor/settings',{method:'POST',headers:{origin:'http://public.example','content-type':'application/json'},body:JSON.stringify(credential)});assert.equal((await handlers.POST(insecure)).status,400);
 assert.equal((await handlers.POST(req('POST',{...credential,key:'bad\nheader-value'}))).status,400);
 assert.equal((await handlers.POST(req('POST',{...credential,model:'https://attacker.example/model'}))).status,400);
 assert.equal((await handlers.POST(req('POST',{...credential,padding:'x'.repeat(2100)}))).status,413);assert.equal(calls,0);
});

test('HTTPS forwarded previews use Secure cookies and Codespaces origins stay narrowly scoped',async()=>{
 const sessions=new TutorSessions();const handlers=settingsHandlers({sessions,site:()=>null,verify:async()=>{}});
 const proxy=new Request('http://localhost:3000/api/tutor/settings',{method:'POST',headers:{host:'sample-3000.app.github.dev',origin:'https://sample-3000.app.github.dev','x-forwarded-proto':'https','content-type':'application/json'},body:JSON.stringify(credential)});
 const response=await handlers.POST(proxy);assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')!,/; Secure/);sessions.remove(response.headers.get('set-cookie')!.split(';')[0].split('=')[1]);
 const previous=process.env.CODESPACE_NAME;process.env.CODESPACE_NAME='test-space';
 try{assert.equal(sameOrigin(new Request('http://localhost:3000/api/tutor',{headers:{origin:'https://test-space-3000.app.github.dev'}})),true);assert.equal(sameOrigin(new Request('http://localhost:3000/api/tutor',{headers:{origin:'https://other-space-3000.app.github.dev'}})),false);}finally{if(previous===undefined)delete process.env.CODESPACE_NAME;else process.env.CODESPACE_NAME=previous;}
});

test('connection tests use fixed read-only endpoints and authorization headers, never a key in the URL',async()=>{
 await verifyCredential(credential,async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/models/gpt-4.1-mini');assert.equal(init?.method,'GET');assert.equal((init!.headers as Record<string,string>).Authorization,`Bearer ${dummy}`);return Response.json({id:'gpt-4.1-mini'});});
 await verifyCredential({key:dummy,provider:'gemini',model:'gemini-3.8-flash'},async(url,init)=>{assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash');assert.ok(!String(url).includes(dummy));assert.equal((init!.headers as Record<string,string>)['x-goog-api-key'],dummy);return Response.json({name:'models/gemini-3.8-flash',supportedGenerationMethods:['generateContent']});});
 await assert.rejects(verifyCredential(credential,async()=>new Response('secret provider message',{status:401})),e=>e instanceof HttpError&&!e.message.includes('secret provider'));
 await assert.rejects(verifyCredential({...credential,provider:'gemini',model:'gemini-3.8-flash'},async()=>Response.json({name:'models/gemini-3.8-flash',supportedGenerationMethods:['embedContent']})),/文字教學/);
 assert.throws(()=>credentialFromInput({...credential,provider:'unknown'}));
});

test('Gemini adapter sends constrained JSON and ignores thought parts',async()=>{
 const evidence=fixture();let called=0;
 const result=await generateTutor({key:dummy,provider:'gemini',model:'gemini-3.8-flash'},evidence,buildLesson(evidence),AbortSignal.timeout(2000),async(url,init)=>{
  called++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');const body=JSON.parse(init!.body as string);
  assert.equal(body.generationConfig.responseMimeType,'application/json');assert.ok(body.generationConfig.responseJsonSchema.required.includes('factIds'));assert.ok(!JSON.stringify(body).includes(dummy));
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'never display this'},{text:JSON.stringify(text)}]}}]});
 });assert.deepEqual(result,text);assert.equal(called,1);
});

test('provider and credential caches do not reuse another key or provider response',async()=>{
 const evidence=fixture();let calls=0;
 const openai=await tutorReply(evidence,{key:'test-only-cache-key-a',provider:'openai',model:'cache-test',fetcher:async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(text)}}]});}});
 const differentKey=await tutorReply(evidence,{key:'test-only-cache-key-b',provider:'openai',model:'cache-test',fetcher:async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(text)}}]});}});
 const gemini=await tutorReply(evidence,{key:'test-only-cache-key-a',provider:'gemini',model:'gemini-cache-test',fetcher:async()=>{calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(text)}]}}]});}});
 assert.equal(openai.source,'ai');assert.equal(differentKey.source,'ai');assert.equal(gemini.source,'ai');assert.equal(calls,3);
});
