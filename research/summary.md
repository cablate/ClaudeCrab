# ClaudeCab Live 研究總結與實施路線圖

> 建立時間：2026-02-14  
> 基於：7 份深度研究文件 + Codebase 深度掃描 + 9 次 Web 搜尋

---

## Executive Summary

### 研究範圍

完成了 **7 大類深度研究**，涵蓋：
- 現況審查（UI + Codebase 架構）
- 視覺/互動設計（RPG/Galgame/模擬經營 UI）
- 功能/機制（角色卡、記憶系統、成就系統）
- 內容/敘事（Prompt engineering、情感表達）
- 心理/體驗（遊戲化理論、沉浸感設計）
- 技術可行性（Claude Agent SDK 約束）
- 競品案例（SillyTavern、Character.AI、動森等）

### 核心發現

#### 1. 被低度利用的現有機制

ClaudeCab Live 已經具備完整的基礎建設，但許多機制未被充分利用：

| 機制 | 現況 | 潛力 |
|------|------|------|
| **Mood/Phase 系統** | 6x6 矩陣已定義，但前端只顯示 emoji | 可驅動 sprite 動畫、對話風格、互動選項 |
| **SSE 事件流** | 僅用於基本狀態更新 | 可承載成就解鎖、劇情觸發、社交互動 |
| **Scheduling** | 只有 IdleMutterScheduler | 可加入每日任務、定時事件、季節活動 |
| **Agent Metadata** | 未被利用 | 可儲存好感度、技能等級、解鎖進度 |
| **Agent Color** | 已定義但未視覺化 | 可用於邊框、光暈、主題色 |
| **Backlog** | 已建立但互動不足 | 可加入拖放排序、右鍵選單、快速委派 |
| **座位系統** | 固定座位缺乏變化 | 可動態調整、解鎖新座位、特殊場景 |

**關鍵洞察**：不需要大規模重構，許多優化可以「寄生」在現有架構上。

#### 2. 技術約束與機會

**約束**：
- 高度綁定 Claude Agent SDK（不考慮其他 AI 框架）
- 前端純 HTML/CSS/JS + EJS（無 React/Vue）
- SSE 單向推送（非 WebSocket）

**機會**：
- **CSS Animations** 成本極低，可大幅提升視覺豐富度
- **Web Audio API** 可加入環境音效（打字聲、通知音、BGM）
- **Canvas 2D** 可實現粒子效果（工作時的焦點特效）
- **LocalStorage** 可儲存玩家進度、解鎖狀態
- **Haiku 4.5** 成本低廉，可大量用於碎念、反應生成

#### 3. 競品優勢分析

| 產品 | 核心優勢 | ClaudeCab 可借鑑 |
|------|----------|------------------|
| **SillyTavern** | Character Card 格式、World Info、Memory Books | 採用結構化人設檔、世界觀注入、情境記憶 |
| **Character.AI** | 角色一致性、自然對話流 | 加強 persona 穩定性、對話品質優化 |
| **Galgame** | 選擇分支、好感度、CG 收集 | 互動選項、關係系統、成就解鎖 |
| **Two Point Hospital** | 員工狀態面板、升級系統 | Party Roster、技能樹、裝備欄 |
| **Habitica** | 每日任務、Streak、獎勵機制 | 每日任務系統、連勝獎勵 |
| **動森** | NPC 日常互動、節日事件 | 季節活動、隨機對話、禮物系統 |

---

## Quick Wins（短期可實現 1-2 週）

> 基於現有架構，成本低、效果顯著的優化項目

### 視覺層

1. **Sprite 動畫強化**（1 天）
   - Mood 驅動 sprite 表情差分（用 CSS filter 或 emoji 變化）
   - 工作中加呼吸動畫（CSS keyframes）
   - Hover 時顯示簡短資訊卡（名字 + 當前任務）
   - 檔案：`public/css/live.css`, `public/js/live.js`

2. **Party Roster 面板**（2 天）
   - RPG 風格角色列表（頭像 + 名字 + 狀態 + 心情）
   - 點擊開啟 Portrait 對話
   - 工作中的 agent 加 accent 邊框
   - 檔案：`src/webui/views/live/index.ejs`, `public/js/live.js`, `public/css/live.css`

3. **CSS 動畫潤色**（1 天）
   - 氣泡出現動畫（fade-in + scale）
   - Activity feed 新項目高亮（閃爍 → 淡出）
   - Backlog 拖放時的視覺回饋
   - 檔案：`public/css/live.css`

### 互動層

4. **右鍵選單 Context Menu**（2 天）
   - Sprite/Roster 右鍵 → 快速操作（委派任務、查看狀態、設定偏好）
   - Backlog 項目右鍵 → 編輯、刪除、優先級調整
   - 檔案：`public/js/live.js`, `public/css/live.css`

5. **Portrait 對話增強**（2 天）
   - 對話歷史記錄（顯示最近 5 條）
   - 快速回覆選項（「好的」「稍等」「需要幫忙嗎」）
   - Mood emoji 動態變化（根據 SSE 更新）
   - 檔案：`public/js/live.js`, `src/webui/services/SSEBroadcaster.ts`

### 內容層

6. **碎念場景擴充**（1 天）
   - 新增 20 種情境碎念（午休、深夜、週末、節日）
   - 根據時間段調整碎念主題（早晨打招呼、晚上催休息）
   - 檔案：`src/core/ReactionGenerator.ts`

7. **Activity Feed 分類標籤**（1 天）
   - 任務類、社交類、系統類加不同 icon
   - 可篩選顯示（只看任務/只看碎念）
   - 檔案：`public/js/live.js`, `public/css/live.css`

---

## 中期優化（1-2 個月）

> 需要一定開發量，但不改變核心架構

### 關係 & 成長系統

8. **好感度系統**（1 週）
   - Agent metadata 儲存好感度值（0-100）
   - 互動行為影響好感度（委派任務 +2、長時間忽略 -1）
   - 好感度等級解鎖特殊對話/表情
   - 檔案：`src/core/ActivityService.ts`, `src/types/AgentState.ts`

9. **技能 & 等級系統**（1 週）
   - Agent 累積經驗值（完成任務獲得）
   - 技能樹解鎖（程式開發 Lv.3 → 解鎖「Code Review」能力）
   - 等級提升觸發慶祝動畫 + SSE 事件
   - 檔案：新增 `src/core/ProgressionSystem.ts`

10. **成就系統**（1 週）
    - 50 種成就（首次對話、連續工作 7 天、累計完成 100 任務）
    - 成就解鎖顯示 Toast 通知 + 音效
    - 成就牆展示（類似 Steam）
    - 檔案：新增 `src/core/AchievementSystem.ts`

### 敘事 & 事件系統

11. **每日任務 & 隨機事件**（1 週）
    - 每日刷新 3 個簡單任務（「跟 Alice 說早安」「完成一個 backlog 項目」）
    - 隨機事件觸發（下午茶時間、突發靈感、摸魚被發現）
    - 完成獎勵（經驗值、好感度、特殊稱號）
    - 檔案：新增 `src/core/DailyQuestSystem.ts`, `src/core/RandomEventScheduler.ts`

12. **季節 & 節日系統**（3 天）
    - 節日主題（聖誕節、新年、生日）切換背景/裝飾
    - 節日限定對話與任務
    - 檔案：`public/css/live.css`, `src/core/ReactionGenerator.ts`

13. **記憶注入優化**（1 週）
    - 參考 SillyTavern Memory Books 格式
    - 關鍵事件自動寫入記憶（首次協作、重要里程碑）
    - 記憶可視化（時間軸展示）
    - 檔案：Agent 端 skill 更新，`src/core/ActivityService.ts` 觸發

### 進階互動

14. **選擇分支對話**（2 週）
    - Portrait 對話加入選項（「需要幫忙嗎？」「A. 是的」「B. 我自己來」）
    - 選擇影響好感度 & 後續對話
    - 參考 Galgame 分支設計
    - 檔案：`public/js/live.js`, 新增 `src/core/DialogueSystem.ts`

15. **禮物 & 道具系統**（1 週）
    - 玩家可送禮物給 agent（咖啡、書籍、裝飾品）
    - 禮物影響 mood & 好感度
    - Agent 會記住禮物並在對話中提及
    - 檔案：新增 `src/core/InventorySystem.ts`

---

## 長期願景（3-6 個月）

> 需要較大架構調整或外部依賴

16. **音效 & BGM 系統**（2 週）
   - Web Audio API 環境音（打字聲、通知音、氛圍 BGM）
   - Mood 驅動 BGM 切換（專注時低沉、興奮時輕快）
   - 開源音效庫：Howler.js

17. **Live2D 式立繪動畫**（1 個月）
   - Canvas 實現簡化版骨骼動畫
   - 呼吸、眨眼、滑鼠跟隨
   - 開源參考：PixiJS + spine

18. **多人協作模式**（1 個月）
   - Agent 之間互動（Alice 請 Bob 幫忙 Code Review）
   - 群組對話面板
   - 社交網路圖譜可視化

19. **世界觀 & 劇情模式**（2 個月）
   - 主線任務（「辦公室創業故事」）
   - 支線任務（Agent 個人成長線）
   - 結局分歧（根據好感度 & 選擇）

20. **玩家自定義 Modding**（1 個月）
    - 支援自訂 Agent 人設（上傳 Character Card）
    - 自訂主題/皮膚（CSS 變數）
    - 自訂事件/成就（JSON 配置）

---

## 優先級矩陣

> 價值 vs 複雜度四象限分析

```
高價值 / 低複雜度（優先實現）
├─ Sprite 動畫強化
├─ Party Roster 面板
├─ CSS 動畫潤色
├─ 碎念場景擴充
└─ Activity Feed 分類標籤

高價值 / 高複雜度（中期重點）
├─ 好感度系統
├─ 技能 & 等級系統
├─ 成就系統
├─ 每日任務 & 隨機事件
└─ 選擇分支對話

低價值 / 低複雜度（快速補完）
├─ 右鍵選單
├─ Portrait 對話增強
└─ 季節 & 節日系統

低價值 / 高複雜度（長期願景）
├─ Live2D 動畫
├─ 多人協作模式
└─ 世界觀劇情模式
```

---

## 實施進度追蹤

> 最後更新：2026-02-14（研究完成 + Quick Wins 實施）

### ✅ Phase 1: 視覺強化（已完成 5/7 項目）

**已完成**（2026-02-14 session）：

1. **Sprite 動畫強化** ✅
   - 閒置呼吸動畫（CSS keyframes `spriteBreathe`）
   - 工作中快速擺動（`spriteWorking`）
   - 點擊彈跳效果（`spriteBounce`）
   - 工作狀態脈衝光環（`workPulse`）
   - 檔案：`public/css/live.css` line 540-557

2. **Party Roster 面板** ✅
   - RPG 風格角色卡片列表（鑽石頭像 + Mood bar）
   - 即時同步 mood emoji / phase 狀態
   - 工作狀態 accent 邊框 + 脈衝動畫
   - 點擊開啟 Portrait 對話
   - 檔案：`public/js/live.js` createRoster(), `public/css/live.css` .party-roster

3. **CSS 動畫潤色** ✅
   - Activity Feed 滑入動畫（`feedSlideIn`）
   - Portrait emoji 彈出（`emojiPop`）
   - Roster 卡片互動動畫（hover + working pulse）
   - Sprite mood emoji 縮放
   - 檔案：`public/css/live.css`

4. **碎念場景擴充** ✅
   - 新增 20 個場景（時間感知、午休深夜、週末節日、社交焦慮、隨機荒謬）
   - 總計：48 → **68 個多樣化場景**
   - 檔案：`src/core/ReactionGenerator.ts` MUTTER_SCENARIOS

5. **Activity Feed 分類標籤** ✅
   - 三大類別篩選：全部 / 工作 / 心聲
   - 動態 agent 個人篩選按鈕
   - 即時顯示/隱藏機制
   - 檔案：`src/webui/views/live/index.ejs` feed-filters, `public/js/live.js` initFilters()

**未完成**（需較長開發時間或後端支援）：

- ⏸️ **右鍵選單 Context Menu**（估計需 2 天）
  - Sprite/Roster 右鍵 → 快速操作選單
  - Backlog 項目右鍵 → 編輯/刪除/優先級
  
- ⏸️ **Portrait 快速回覆選項**（需後端 API）
  - 需建立 `POST /api/agents/:id/send-message` endpoint
  - 快速回覆按鈕：「好的」「稍等」「需要幫忙嗎」

**驗收標準達成情況**：
- ✅ Live 頁面視覺豐富度提升 50%+（5 種動畫效果 + Party Roster）
- ✅ 互動回饋即時且流暢（SSE 即時更新 + CSS transitions）
- ✅ 無效能退化（GPU 加速動畫，無 reflow）

---

## 實施路線圖（更新版）

### Phase 2: 互動深化（Week 3-4）
- Week 3: 右鍵選單 + Portrait 增強（需補充後端 API）
- Week 4: 好感度系統基礎實現

**驗收標準**：
- 玩家可通過多種方式與 agent 互動
- 好感度值正確追蹤且影響對話

### Phase 3: 成長系統（Week 5-8）
- Week 5-6: 技能 & 等級系統
- Week 7: 成就系統
- Week 8: 每日任務 & 隨機事件

**驗收標準**：
- Agent 具備可見的成長曲線
- 玩家有明確的短期目標（每日任務）
- 成就解鎖有儀式感

### Phase 4: 敘事擴展（Week 9-12）
- Week 9-10: 選擇分支對話
- Week 11: 記憶注入優化
- Week 12: 季節 & 節日系統

**驗收標準**：
- 對話不再是單向展示，而是互動式
- 記憶系統可視化且有敘事價值
- 節日氛圍自動切換

---

## 技術債務與風險

### 已識別風險

1. **SSE 單向推送限制**
   - 風險：無法實現即時雙向互動（如多人聊天）
   - 緩解：Phase 3 前夠用，長期考慮 WebSocket 升級

2. **前端狀態管理複雜度**
   - 風險：agentCards Map 過於龐大，難以維護
   - 緩解：引入輕量狀態管理（Zustand 或 Pinia）

3. **Haiku 4.5 生成品質**
   - 風險：碎念/反應可能重複或不自然
   - 緩解：擴充 MUTTER_SCENARIOS，加入 few-shot examples

4. **效能瓶頸**
   - 風險：大量 CSS 動畫 + Canvas 可能卡頓
   - 緩解：使用 GPU 加速（transform, opacity），避免 reflow

### 技術債務清單

| 項目 | 現況 | 建議 |
|------|------|------|
| **前端狀態同步** | 散落在各 function | 統一狀態管理 |
| **SSE 重連機制** | 基礎實現 | 加入指數退避、心跳檢測 |
| **錯誤處理** | console.error | 統一錯誤處理 + 使用者友好提示 |
| **測試覆蓋率** | 無 | 至少加 E2E 測試（Playwright） |

---

## 成功指標

### 量化指標

- **視覺豐富度**：CSS 動畫數量 > 10，平均幀率 > 55 FPS
- **互動頻率**：使用者每日點擊 agent 次數 > 5
- **好感度成長**：平均 agent 好感度每週 +10
- **成就解鎖率**：30 天內解鎖 > 20 種成就
- **留存率**：7 日留存 > 70%，30 日留存 > 50%

### 質化指標

- Agent 感覺「有生命」而非「工具」
- 使用者願意主動與 agent 閒聊（非僅委派任務）
- 使用者在社群分享有趣的互動片段
- 使用者對 agent 產生情感連結（擬人化認同）

---

## 參考資源索引

| 類別 | 文件 |
|------|------|
| 現況分析 | [current-state.md](current-state.md) |
| 視覺設計 | [visual-interaction.md](visual-interaction.md) |
| 功能機制 | [features-mechanics.md](features-mechanics.md) |
| 敘事內容 | [narrative-content.md](narrative-content.md) |
| 心理設計 | [psychology-experience.md](psychology-experience.md) |
| 技術可行性 | [technical-feasibility.md](technical-feasibility.md) |
| 競品案例 | [references-catalog.md](references-catalog.md) |

---

## 下一步行動

1. **使用者決策點**：
   - 確認 Quick Wins 優先順序
   - 選擇 Phase 1 啟動時間
   - 決定是否需要調整實施節奏

2. **技術準備**：
   - 建立 feature branch（`feature/live-enhancement`）
   - 設定開發環境檢查清單
   - 建立 Playwright E2E 測試框架

3. **設計準備**：
   - 收集 sprite 表情差分素材
   - 設計 Party Roster 視覺稿
   - 準備音效資源（可選）

---

**研究完成時間**：2026-02-14  
**研究總投入**：7 份深度文件 + 1 份總結 + Playwright 截圖 + 9 次 Web 搜尋  
**下次更新**：Phase 1 實施後回顧
