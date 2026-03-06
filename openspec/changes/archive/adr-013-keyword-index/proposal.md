# Skill Description 關鍵詞索引 vs 內容窮舉

## Why

觀察到 agent 被問及 skill 內部概念（如「Pattern 是什麼」）時，無法立即回答，需要去查檔案。原因是 metadata description 裡沒有提及這些關鍵詞，agent 無法從 description 聯想到該 skill。問題在於是否應該在 description 加入 skill 內部的專有名詞，這會不會違反「不要窮舉」的原則。

## What Changes

在 description 加入**關鍵詞索引**，但不解釋定義。關鍵區別：

- **索引**（列出名稱）：告訴 agent「這裡有什麼」 -- 善用機制
- **窮舉**（解釋定義）：把內容搬到外面 -- 違反原則

類比：索引是書的目錄，列出章節名稱，不解釋內容。

## Capabilities

- 索引讓 agent 知道「這個概念在哪個 skill」，增加觸發準確性
- 不佔太多 token 預算（只列名稱）
- 實際定義還是在 skill 內部，保持 progressive disclosure
- 善用 metadata 預載機制，關鍵詞在 context 裡增加聯想機會

## Trade-offs

- 需要手動維護 description 中的關鍵詞列表
- description 變長，佔用更多 context 空間（但相比窮舉仍很精簡）
