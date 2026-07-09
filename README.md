# 2026 世界盃冠軍預測

給大家看的靜態頁面，只有你自己會更新資料，其他人單純瀏覽。

## 目錄結構

```
index.html          頁面本體
style.css           樣式
app.js              讀取 CSV / 設定並渲染畫面的邏輯
data/config.json    很少更動：標題、截止時間、四強隊伍
data/bets.csv       常常更動：每一筆投注紀錄
```

## 日常更新（你唯一需要常做的事）

打開 `data/bets.csv`，用 Excel、Numbers 或任何文字編輯器新增一列即可，欄位如下：

```csv
name,team,amount,note
王小明,阿根廷,1000,梅西最後一舞
```

- `name`：下注者名稱
- `team`：必須跟 `data/config.json` 裡四強隊伍的 `name`（或 `id`）完全相同，例如「阿根廷」
- `amount`：下注金額，純數字
- `note`：備註，可留空；若內容包含逗號，請用雙引號包起來，例如 `"梅西, 最後一舞"`

存檔後 push 到 GitHub，網頁最多 60 秒內會自動更新（或按頁面上的「重新整理資料」立即刷新）。畫面上的參與人數、投注筆數、總金額、四強各自金額與名單，全部都是從這份 CSV 自動加總出來的，不用另外維護 summary。

如果某一列的 `team` 打錯字、對不到四強任何一隊，頁面上方會出現黃色警告列出是哪幾筆有問題，方便你抓錯字。

## 偶爾才需要改的設定：`data/config.json`

```json
{
  "title": "2026 世界盃冠軍預測",
  "subtitle": "四強對決・誰是真命天子？",
  "deadlineISO": "2026-07-15T18:00:00+08:00",
  "currencyPrefix": "NT$ ",
  "teams": [
    { "id": "ARG", "name": "阿根廷", "code": "AR", "colorFrom": "#75AADB", "colorTo": "#1B3B6F" }
  ]
}
```

- `deadlineISO`：投注截止時間，倒數計時跟這個值連動，過了就會自動顯示「投注已截止」
- `teams`：四強隊伍，`code` 是 ISO 兩碼國碼（用來自動產生國旗 emoji，例如阿根廷是 `AR`、法國 `FR`），`colorFrom`/`colorTo` 是卡片底色漸層，可依隊伍配色調整
- 確定四強名單後（等賽事打完四分之一決賽），把這四個隊伍換掉即可；名稱要跟 `bets.csv` 裡的 `team` 欄位完全一致

## 部署到 GitHub Pages

1. 建一個新的 GitHub repo，把這個資料夾所有檔案原封不動放進去（保留 `data/` 子目錄結構）
2. Push 上去後，到 repo 的 Settings → Pages，Source 選 `main` branch、根目錄 `/`
3. 稍等一下，GitHub 會給你一個 `https://<你的帳號>.github.io/<repo名稱>/` 的網址，就可以分享給大家看了

## 本機測試注意事項

直接用瀏覽器打開 `index.html`（`file://...`）會因為瀏覽器安全限制讀不到 CSV。本機測試請開一個簡易伺服器，例如在這個資料夾下執行：

```bash
python3 -m http.server 8000
```

然後瀏覽器打開 `http://localhost:8000`。上線到 GitHub Pages 後就沒有這個問題，直接能用。
