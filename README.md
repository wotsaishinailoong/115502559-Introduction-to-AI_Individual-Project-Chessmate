# 棋伴 Chessmate

面向初學者的西洋棋練習網站。第一階段提供響應式棋盤與本機 Stockfish AI 對戰；漏著分析與 LLM 教學尚未實作。

## 開發

需要 Node.js 22.18+（本環境使用 24）與 npm。

```sh
npm ci
npm run dev
```

開發伺服器使用 3000 埠。`postinstall` 會將固定版本 Stockfish 17.1.0 的單執行緒 lite WASM 複製到 `public/engine/`，無需 API key。瀏覽器需要支援 WebAssembly 與 Web Worker。引擎首次下載約數 MB；難度為相對強度，未校準 Elo。

## 功能

- 點選或拖曳落子、合法目的格、四種升變、將軍與終局判定。
- 執白／執黑、三段難度、AI 搜尋取消與錯誤重試。
- 悔棋回到玩家上次落子前、翻轉棋盤、逐手回放、PGN 下載。
- localStorage 保存目前棋局與設定，重整後恢復完整走法歷史。
- 三次重複局面、五十步規則採自動和棋，適用自由練習；沒有時鐘與正式競賽裁判流程。
- 新對局會取代本機紀錄；可先匯出 PGN。尚無帳號、雲端儲存、PGN 匯入或多裝置同步。

## 驗證

```sh
npm test
npm run typecheck
npm run build
npm run start -- --port 3001
```

另開終端執行瀏覽器測試（針對 3001 埠的正式版）：

```sh
npx playwright install chromium
npm run test:e2e
```

若已有系統 Chromium，可使用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。規則測試涵蓋雙方悔棋、將死、重複局面恢復、王車易位、吃過路兵與升變；瀏覽器測試會實際運行 WASM 引擎，驗證回應、回放、恢復、下載與手機排版。

## 程式結構

- `app/chess-app.tsx`：棋局互動與響應式 UI。
- `lib/engine.ts`：Stockfish UCI Worker、搜尋預算與取消。
- `lib/game.ts`：對局狀態與悔棋。
- `scripts/copy-engine.mjs`：安裝時準備引擎靜態檔案。

每次 AI 搜尋使用獨立 Worker，悔棋或新對局會終止舊 Worker。前端目前只存對局資料，不發送到外部 AI API。

## 第三方授權

Stockfish.js 17.1.0 使用 GPLv3，未修改引擎檔案。安裝時同步保留 COPYING 與 AUTHORS，於 `/engine/COPYING.txt`、`/engine/AUTHORS.txt` 可取得。上游為 https://github.com/nmrugg/stockfish.js ，套件版本為 https://www.npmjs.com/package/stockfish/v/17.1.0 。公開散布 WASM 前，需依 GPLv3 同步提供該建置對應的完整原始碼與建置材料；這個開發雛形尚未準備公開散布用的原始碼封裝。

## 後續階段

1. 背景分析與一致搜尋預算的失誤比較。
2. 局勢曲線與最多三個關鍵時刻。
3. 引擎證據支持的繁體中文解釋與重走練習。
