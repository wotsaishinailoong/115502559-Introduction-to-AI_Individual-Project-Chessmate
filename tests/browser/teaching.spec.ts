import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function openLesson(page: Page) {
  await page.goto('/review');
  await page.getByRole('button', { name: '使用教學範例' }).click();
  await page.getByRole('button', { name: '開始分析棋局' }).click();
  await expect(page.getByRole('heading', { name: '白方的關鍵時刻' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button').filter({ hasText: '2. g4' }).click();
}

test('engine teaching works without a key: hints hide the answer, variations move the board, and lecture downloads', async ({ page }) => {
  test.setTimeout(90000);
  let requests=0;page.on('request',r=>{if(r.url().endsWith('/api/tutor')&&r.method()==='POST')requests++;});
  await openLesson(page);
  await page.getByRole('button', {name:'給我提示'}).click();
  await expect(page.locator('.lesson-hint')).toContainText('將軍');
  await expect(page.locator('.answer')).toHaveCount(0);
  await page.getByRole('button',{name:'查看參考答案'}).click();
  await expect(page.getByRole('heading',{name:'先看國王是否安全'})).toBeVisible();
  await expect(page.getByRole('button',{name:'AI 教練尚未啟用'})).toBeDisabled();
  await page.getByRole('button',{name:'播放原走法',exact:true}).click();
  await expect(page.locator('.review-board-heading')).toContainText('原走法變化 · 第 0 手');
  await page.getByRole('button',{name:'變化線下一步'}).click();
  await expect(page.locator('[data-square="g4"] [data-piece="wP"]')).toBeVisible();
  await page.getByRole('button',{name:'變化線下一步'}).click();
  await expect(page.locator('[data-square="h4"] [data-piece="bQ"]')).toBeVisible();
  await page.getByRole('button',{name:'變化線上一步'}).click();
  await expect(page.locator('[data-square="d8"] [data-piece="bQ"]')).toBeVisible();
  await page.getByRole('button',{name:'回到重走',exact:true}).click();
  await expect(page.locator('.review-board-heading')).toContainText('2. g4 之前');
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'下載復盤講義'}).click();
  const download=await downloading;
  expect(download.suggestedFilename()).toBe('chessmate-review.md');
  const text=await readFile((await download.path())!,'utf8');
  expect(text).toContain('Qh4#');expect(text).toContain('下次記得');
  expect(requests).toBe(0);
});

test('optional AI explanation is explicit, shows its source and leaves verified lines available', async ({ page }) => {
  test.setTimeout(90000);
  let requests=0;
  await page.route('**/api/tutor',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{available:true}});
    requests++;
    const body=route.request().postDataJSON();
    expect(body.fen).toBeTruthy();expect(body.pgn).toBeUndefined();
    await route.fulfill({json:{source:'ai',notice:'AI 回覆仍需配合引擎變化核對。',text:{title:'先找對手的將軍',why:['示範線中對手用 Qh4# 將死你的國王。'],better:'比較引擎建議，再逐步播放變化。',takeaway:'落子前先檢查對手的將軍。',factIds:['reply']}}});
  });
  await openLesson(page);
  expect(requests).toBe(0);
  await page.getByRole('button',{name:'查看參考答案'}).click();
  const button=page.getByRole('button',{name:'請 AI 教練解說這一步'});
  await expect(button).toBeEnabled(); expect(requests).toBe(0);
  await button.click();
  await expect(page.getByRole('heading',{name:'先找對手的將軍'})).toBeVisible();
  await expect(page.locator('.lesson-label')).toContainText('AI 教練解說');
  await expect(page.getByRole('button',{name:'已取得 AI 解說'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'播放原走法',exact:true})).toBeEnabled();
  expect(requests).toBe(1);
});

test('failed AI service falls back without losing the lesson or retry controls on mobile', async ({ page }) => {
  test.setTimeout(90000);await page.setViewportSize({width:390,height:844});
  await page.route('**/api/tutor',route=>route.request().method()==='GET'?route.fulfill({json:{available:true}}):route.fulfill({status:503,json:{error:'unavailable'}}));
  await openLesson(page); await page.getByRole('button',{name:'查看參考答案'}).click();
  await page.getByRole('button',{name:'請 AI 教練解說這一步'}).click();
  await expect(page.locator('.tutor-notice')).toContainText('先使用下方的引擎教學');
  await expect(page.getByRole('heading',{name:'先看國王是否安全'})).toBeVisible();
  await expect(page.getByRole('button',{name:'再試一次'})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/chessmate-teaching-mobile.png',fullPage:true});
});

test('the real same-origin API accepts validated evidence and provides no-key teaching', async ({ request }) => {
  const status = await request.get('/api/tutor');
  const capability = await status.json();
  test.skip(capability.available, 'Do not make paid provider requests in the no-key integration test.');
  const origin = new URL(status.url()).origin;
  const response = await request.post('/api/tutor', { headers: { origin }, data: {
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2',
    uci: 'g2g4', best: { score: {kind:'cp',value:-100}, pv:['g2g3','d7d5'] },
    played: { score: {kind:'mate',winner:'b',moves:1}, pv:['g2g4','d8h4'] },
  } });
  expect(response.status()).toBe(200);
  const lesson = await response.json();
  expect(lesson.source).toBe('engine');
  expect(lesson.text.why.join(' ')).toContain('Qh4#');
});
