# Tasks

## Phase 1：資料讀取層
- [ ] 新增 API endpoint `GET /api/agents/:agentId/character`
- [ ] 實作 Markdown parser（proficiency、achievements、stats）
- [ ] 加入檔案存在性檢查與 fallback 處理

## Phase 2：前端元件
- [ ] 新增 Character Sheet 頁面（shadcn/ui Card + Progress + Badge）
- [ ] 星級（★☆☆☆☆）渲染
- [ ] 成就進度條
- [ ] 響應式設計（手機、平板、桌面）

## Phase 3：導航整合
- [ ] Agent 詳情頁新增「角色面板」Tab
- [ ] 快取機制（TTL 5 分鐘）

## 驗收標準
- [ ] API 回傳正確結構化資料
- [ ] 檔案不存在時顯示友善訊息
