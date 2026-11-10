import { test, expect } from '@playwright/test';
import { Chess } from 'chess.js';

test('real Stockfish finds the missed mate defence, hides the answer, grades retries and replays the chart', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/review');
  await page.getByRole('button', { name: '使用教學範例' }).click();
  await page.getByRole('button', { name: '開始分析棋局' }).click();
  await expect(page.getByRole('heading', { name: '白方的關鍵時刻' })).toBeVisible({ timeout: 60000 });
  const moment = page.getByRole('button').filter({ hasText: '2. g4' });
  await expect(moment).toContainText('允許對方將殺');
  await moment.click();
  await expect(page.locator('.answer')).toHaveCount(0);
  await page.locator('[data-square="g2"]').click(); await page.locator('[data-square="g4"]').click();
  await expect(page.locator('.retry-panel [role="status"]')).toContainText('還有改進空間', { timeout: 30000 });
  await page.getByRole('button', { name: '查看參考答案' }).click();
  await expect(page.locator('.answer')).toContainText('Qh4#');
  const bestSan = (await page.locator('.answer strong').innerText()).split('：')[1];
  const game = new Chess(); game.move('f3'); game.move('e5');
  const move = game.move(bestSan);
  await page.getByRole('button', { name: '再試一次' }).click();
  await expect(page.locator('.answer')).toHaveCount(0);
  await page.locator(`[data-square="${move.from}"]`).click(); await page.locator(`[data-square="${move.to}"]`).click();
  await expect(page.locator('.retry-panel [role="status"]')).toContainText('做得好', { timeout: 30000 });
  await page.getByLabel('選擇評分走法').selectOption('0');
  await expect(page.locator('.review-board-heading')).toContainText('開局局面');
  await expect(page.locator('.retry-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('review validates PGN, cancels work, reruns for black, and fits mobile', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review');
  await page.getByLabel('PGN 棋譜').fill('1. e4 invalid');
  await page.getByRole('button', { name: '開始分析棋局' }).click();
  await expect(page.locator('.analysis-input [role="alert"]')).toContainText('PGN');
  await expect(page.getByRole('heading', { name: '局勢走勢' })).toHaveCount(0);
  await page.getByRole('button', { name: '使用教學範例' }).click();
  await page.getByRole('button', { name: '開始分析棋局' }).click();
  await page.getByRole('button', { name: '取消分析' }).click();
  await expect(page.locator('.analysis-input [role="status"]')).toContainText('分析已取消');
  await expect(page.getByRole('heading', { name: '局勢走勢' })).toHaveCount(0);
  await page.getByRole('button', { name: '黑方', exact: true }).click();
  await page.getByRole('button', { name: '開始分析棋局' }).click();
  await expect(page.getByRole('heading', { name: '黑方的關鍵時刻' })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.no-moments')).toContainText('沒有找到');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/chessmate-review-mobile.png', fullPage: true });
});


test('engine load failure reports an error and leaves no incomplete report', async ({ page }) => {
  await page.route('**/engine/stockfish-*.js', route => route.abort());
  await page.goto('/review');
  await page.getByRole('button', { name: '使用教學範例' }).click();
  await page.getByRole('button', { name: '開始分析棋局' }).click();
  await expect(page.locator('.analysis-input [role="alert"]')).toContainText('無法載入');
  await expect(page.getByRole('heading', { name: '局勢走勢' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '開始分析棋局' })).toBeEnabled();
});
