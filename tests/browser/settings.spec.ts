import { test, expect, type Page } from '@playwright/test';
const none={available:false,source:'none',provider:null,model:null,expiresAt:null};
const dummy='test-only-not-a-real-browser-key';
async function containsKey(page:Page){return page.evaluate(secret=>JSON.stringify({...localStorage,...sessionStorage}).includes(secret),dummy);}

test('connect OpenAI and Gemini, confirm session status, reload without showing the key, and remove connection',async({page})=>{
 let current:Record<string,unknown>={...none};let sent=0;
 await page.route('**/api/tutor/settings',async route=>{
  const method=route.request().method();
  if(method==='GET')return route.fulfill({json:current});
  if(method==='DELETE'){current={...none};return route.fulfill({json:current});}
  const input=route.request().postDataJSON();sent++;expect(input.key).toBe(dummy);expect(['openai','gemini']).toContain(input.provider);
  current={available:true,source:'personal',provider:input.provider,model:input.model,expiresAt:Date.now()+3600000};return route.fulfill({json:current});
 });
 await page.goto('/settings');await page.locator('#tutor-api-key').fill(dummy);await page.getByRole('button',{name:'顯示金鑰'}).click();await expect(page.locator('#tutor-api-key')).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'測試連線並暫存',exact:true}).click();
 await expect(page.locator('.connection-status')).toContainText('已使用個人金鑰連線');await expect(page.locator('.connection-status')).toContainText('OpenAI');
 await expect(page.locator('#tutor-api-key')).toHaveValue('');await expect(page.locator('#tutor-api-key')).toHaveAttribute('type','password');expect(await containsKey(page)).toBe(false);
 await page.getByRole('button',{name:'Google Gemini',exact:true}).click();await expect(page.locator('#tutor-model')).toHaveValue('gemini-3.8-flash');await page.locator('#tutor-api-key').fill(dummy);
 await page.getByRole('button',{name:'測試連線並暫存',exact:true}).click();await expect(page.locator('.connection-status')).toContainText('Google Gemini');
 await page.reload();await expect(page.locator('.connection-status')).toContainText('Google Gemini');await expect(page.locator('#tutor-api-key')).toHaveValue('');
 await page.getByRole('button',{name:'移除個人連線',exact:true}).click();await expect(page.locator('.connection-badge')).toHaveText('尚未連線');await expect(page.getByRole('button',{name:'移除個人連線',exact:true})).toBeDisabled();
 expect(sent).toBe(2);expect(await containsKey(page)).toBe(false);
});

test('failed replacement leaves a working connection intact and the mobile settings and game remain usable',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 const current={available:true,source:'personal',provider:'openai',model:'gpt-4.1-mini',expiresAt:Date.now()+3600000};
 await page.route('**/api/tutor/settings',route=>route.request().method()==='GET'?route.fulfill({json:current}):route.fulfill({status:400,json:{error:'金鑰無效或沒有模型存取權，原有連線未變更。'}}));
 await page.goto('/settings');await expect(page.locator('.connection-status')).toContainText('OpenAI');await page.getByRole('button',{name:'Google Gemini',exact:true}).click();await page.locator('#tutor-api-key').fill(dummy);
 await page.getByRole('button',{name:'測試連線並暫存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'金鑰無效'})).toBeVisible();await expect(page.locator('.connection-status')).toContainText('OpenAI');
 expect(await containsKey(page)).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/chessmate-settings-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'對弈練習',exact:true}).click();await expect(page.locator('[data-square="e2"]')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a failed session roundtrip never claims the key is connected',async({page})=>{
 await page.route('**/api/tutor/settings',route=>route.fulfill({json:route.request().method()==='GET'?none:{available:true,source:'personal',provider:'openai',model:'gpt-4.1-mini',expiresAt:Date.now()+3600000}}));
 await page.goto('/settings');await page.locator('#tutor-api-key').fill(dummy);await page.getByRole('button',{name:'測試連線並暫存',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Cookie'})).toBeVisible();await expect(page.locator('.connection-badge')).toHaveText('尚未連線');await expect(page.locator('#tutor-api-key')).toHaveValue('');expect(await containsKey(page)).toBe(false);
});

test('real settings routes expose only connection metadata and reject invalid writes without provider calls',async({request})=>{
 const result=await request.get('/api/tutor/settings');expect(result.status()).toBe(200);const data=await result.json();expect(Object.keys(data).sort()).toEqual(['available','expiresAt','model','provider','source']);
 const origin=new URL(result.url()).origin;
 const invalid=await request.post('/api/tutor/settings',{headers:{origin},data:{provider:'openai',model:'gpt-4.1-mini',key:'short'}});expect(invalid.status()).toBe(400);expect(invalid.headers()['set-cookie']).toBeUndefined();
 const blocked=await request.post('/api/tutor/settings',{headers:{origin:'https://other.example'},data:{provider:'openai',model:'gpt-4.1-mini',key:dummy}});expect(blocked.status()).toBe(403);
 const deleted=await request.delete('/api/tutor/settings',{headers:{origin}});expect(deleted.status()).toBe(200);expect(deleted.headers()['set-cookie']).toContain('Max-Age=0');
});
