import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const KEY='chessmate.library.v1';
async function analyze(page:Page){
 await page.goto('/review');await page.getByRole('button',{name:'使用教學範例'}).click();await page.getByRole('button',{name:'開始分析棋局'}).click();
 await expect(page.getByRole('heading',{name:'白方的關鍵時刻'})).toBeVisible({timeout:60000});
}
async function bestMove(page:Page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).entries[0].analysis[2].best.pv[0] as string,KEY);}
async function play(page:Page,move:string){await page.locator(`[data-square="${move.slice(0,2)}"]`).click();await page.locator(`[data-square="${move.slice(2,4)}"]`).click();await expect(page.locator('.retry-panel > p[aria-live="polite"]')).toContainText('做得好',{timeout:30000});}

test('reports restore without rerunning engines, reanalysis deduplicates, and practice distinguishes assistance',async({page})=>{
 test.setTimeout(120000);await analyze(page);await expect(page.locator('.saved-indicator')).toContainText('已保存');
 const id=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).entries[0].id,KEY);
 await page.route('**/engine/stockfish-*.js',r=>r.abort());
 await page.reload();await expect(page.getByRole('heading',{name:'白方的關鍵時刻'})).toBeVisible();await page.unroute('**/engine/stockfish-*.js');
 await page.getByRole('button',{name:'重新分析棋局'}).click();await expect(page.locator('.saved-indicator')).toBeVisible({timeout:60000});
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).entries.length,KEY)).toBe(1);
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).entries[0].id,KEY)).toBe(id);
 const move=await bestMove(page);await page.getByRole('button').filter({hasText:'2. g4'}).click();await play(page,move);
 await expect(page.locator('.practice-summary')).toHaveText('練習 1 次 · 答對 1 次 · 獨立答對 1 次');
 await page.getByRole('button',{name:'再試一次'}).click();await page.getByRole('button',{name:'給我提示'}).click();await play(page,move);
 await expect(page.locator('.practice-summary')).toHaveText('練習 2 次 · 答對 2 次 · 獨立答對 1 次');
 await page.getByRole('button').filter({hasText:'2. g4'}).click();await play(page,move);
 await expect(page.locator('.practice-summary')).toHaveText('練習 3 次 · 答對 3 次 · 獨立答對 1 次');
 await page.getByRole('link',{name:'我的複習',exact:true}).click();await expect(page.locator('.saved-report')).toHaveCount(1);
 await expect(page.locator('.learning-stats>div').filter({hasText:'練習次數'}).locator('strong')).toHaveText('3');
 await page.getByLabel('篩選複習主題').selectOption('國王安全與將軍');await page.getByLabel('只看待加強').check();await expect(page.locator('.practice-item')).toHaveCount(0);
 await page.getByLabel('只看待加強').uncheck();await page.getByRole('link',{name:'開始複習 →'}).click();
 await expect(page.locator('.review-board-heading')).toContainText('2. g4 之前');await expect(page.locator('.answer')).toHaveCount(0);
 await page.reload();await expect(page.locator('.practice-summary')).toContainText('練習 3 次');
});

test('backup import is idempotent, invalid input preserves data, and deletion requires confirmation',async({page})=>{
 test.setTimeout(90000);await analyze(page);
 await page.evaluate(()=>localStorage.setItem('chessmate.game.v1','{"pgn":"1. e4","player":"w","level":"beginner","resigned":false}'));
 const originalGame=await page.evaluate(()=>localStorage.getItem('chessmate.game.v1'));
 await page.getByRole('link',{name:'我的複習',exact:true}).click();
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'匯出備份',exact:true}).click();
 const file=await downloading;const data=await readFile((await file.path())!,'utf8');expect(JSON.parse(data).entries.length).toBe(1);
 await page.locator('input[type="file"]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(data)});
 await expect(page.getByRole('status')).toContainText('目前共有 1 份報告');await expect(page.locator('.saved-report')).toHaveCount(1);
 const before=await page.evaluate(key=>localStorage.getItem(key),KEY);
 await page.locator('input[type="file"]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":999}')});
 await expect(page.locator('.library-page [role="alert"]')).toContainText('格式');expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(before);
 await page.getByRole('button',{name:'刪除白方分析報告'}).click();await page.getByRole('button',{name:'保留報告'}).click();await expect(page.locator('.saved-report')).toHaveCount(1);
 await page.getByRole('button',{name:'刪除白方分析報告'}).click();await page.getByRole('button',{name:'確認刪除',exact:true}).click();
 await expect(page.getByRole('heading',{name:'從第一份復盤開始'})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('chessmate.game.v1'))).toBe(originalGame);
 await page.locator('input[type="file"]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(data)});
 await expect(page.locator('.saved-report')).toHaveCount(1);await page.getByRole('link',{name:'開啟報告',exact:true}).click();await expect(page.getByRole('heading',{name:'局勢走勢'})).toBeVisible();
});

test('corrupted storage remains exportable, analysis stays usable, and the library fits mobile',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:844});await analyze(page);
 const backup=await page.evaluate(key=>localStorage.getItem(key)!,KEY);await page.getByRole('link',{name:'我的複習',exact:true}).click();await expect(page.locator('.library-page')).toBeVisible();
 await page.evaluate(key=>localStorage.setItem(key,'corrupted-original-data'),KEY);await page.reload();
 await expect(page.locator('.library-page [role="alert"]')).toContainText('未被覆寫');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'匯出原始備份'}).click();
 expect(await readFile((await (await downloading).path())!,'utf8')).toBe('corrupted-original-data');
 await analyze(page);await expect(page.locator('.storage-warning')).toContainText('尚未保存');
 await expect(page.getByRole('heading',{name:'局勢走勢'})).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('corrupted-original-data');
 await page.getByRole('link',{name:'我的複習',exact:true}).click();
 await page.locator('input[type="file"]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
 await expect(page.getByRole('heading',{name:'用備份還原複習紀錄？'})).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe('corrupted-original-data');
 await page.getByRole('button',{name:'確認還原',exact:true}).click();await expect(page.locator('.saved-report')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/chessmate-library-mobile.png',fullPage:true});
});
