## 1. Evolution Directory Structure 建立

- [x] 1.1 [P] 在 agents/general/ 建立 evolution/weekly/ 和 evolution/proposals/ 目錄（Evolution Directory Structure，Decision: evolution/ 獨立目錄而非混入 memory/）
- [x] 1.2 [P] 在 agents/admin/ 建立 evolution/weekly/ 和 evolution/proposals/ 目錄（Evolution Directory Structure）
- [x] 1.3 [P] 更新 agents/_example/ 範本，加入 evolution/ 目錄結構說明，確保 Agent 設定目錄結構規範涵蓋新目錄

## 2. CLAUDE.md 使用者期待區段

- [x] 2.1 [P] 在 agents/general/CLAUDE.md 頂部（核心原則之前）新增 User Expectations Section in CLAUDE.md，以條列式定義使用者對秘書的品質標準與行為期待（Decision: 使用者期待存放於 CLAUDE.md 高權重區段）
- [x] 2.2 [P] 在 agents/admin/CLAUDE.md 頂部新增 User Expectations Section，定義使用者對總管的管理品質期待

## 3. 三層權限模型文件化

- [x] 3.1 將 Three-Layer Permission Model 寫入 Agent 共用規則（agents/_example/.claude/rules/ 或對應的 protocol skill），明確定義 Layer 1/2/3 的檔案範圍與操作限制（Decision: 三層權限模型而非二元控制）
- [x] 3.2 定義 Layer 3 Proposal Review 的提案檔案格式模板，寫入 agents/_example/ 供所有 Agent 參考

## 4. Daily Reflection 排程與協議

- [x] 4.1 撰寫 Daily Reflection Cycle 協議文件，定義五階段流程：回顧 → 比對期待 → 上網搜尋 → 內化 → 記錄。明確標註 Web Search During Reflection 為核心步驟而非可選步驟。體現 Decision: 反思是合成者不是收集者
- [x] 4.2 [P] 建立 agents/general/schedules/daily-reflection.yaml 排程定義，設定 22:00 觸發（Decision: 排程時間安排）
- [x] 4.3 [P] 建立 agents/admin/schedules/daily-reflection.yaml 排程定義，設定 22:00 觸發

## 5. Weekly Growth Review 排程與協議

- [x] 5.1 撰寫 Weekly Growth Review Cycle 協議文件，定義四階段流程：收集反思摘要 → Growth Metrics Evaluation（學習量/應用率/品質趨勢）→ 審核 Layer 3 提案 → 產出週報
- [x] 5.2 定義 Weekly Report Format 規範：每 Agent 2-3 句成長摘要 + 待審提案 + 下週建議方向，總長不超過 2000 字元。包含 Stale proposal escalation 規則（超過兩週升級為「需要關注」）
- [x] 5.3 建立 agents/admin/schedules/weekly-growth-review.yaml 取代現有 weekly-collaboration-review.yaml（Decision: 週報合併現有 weekly-collaboration-review），設定週日 21:00 觸發，整合協作健康度與成長審查

## 6. Design Revision: 每日員工審查

- [x] 6.1 [P] 建立 agents/admin/schedules/daily-growth-review.yaml（22:30 觸發），實作 Daily Growth Review Cycle 和 Daily Report Format 的完整四階段日報流程（Decision: 每日完整品質審查而非僅週報）
- [x] 6.2 更新 agents/_example/evolution/GROWTH-REVIEW-PROTOCOL.md，新增「每日審查」區段（含日報格式），將原「四階段流程」拆分為每日審查 + 每週趨勢分析
- [x] 6.3 更新 agents/admin/schedules/weekly-growth-review.yaml，實作 Weekly Trend Analysis Cycle、Weekly Trend Metrics、Weekly Trend Report Format，將職責從完整審查改為週趨勢分析（基於日報做 meta-pattern）
- [x] 6.4 [P] 建立 knowledge/growth-reviews/daily/ 和 knowledge/growth-reviews/weekly/ 目錄結構
- [x] 6.5 更新 agents/admin/knowledge/self-evolution-management-guide.md，加入每日審查職責、更新機制全貌圖
- [x] 6.6 更新 agents/_example/.claude/rules/self-evolution.md 提案流程描述（「週報中審核」→「每日審查中審核」）

## 7. Design Revision: 品質嚴謹化

- [x] 7.1 重寫 REFLECTION-PROTOCOL.md Phase 5 格式（加前日缺口追蹤、搜尋關鍵字/來源/收穫/應用計畫）
- [x] 7.2 新增缺口升級規則（Day 1 正常 → Day 2 要進度 → Day 3 換策略 → Day 3+ 標記需要協助）
- [x] 7.3 新增無工作日「主動學習日」模式（朝使用者期待深度學習，不是休假）
- [x] 7.4 明確 Layer 3 提案執行權歸主管（self-evolution.md + TEMPLATE.md 加執行紀錄欄位）
- [x] 7.5 重寫 GROWTH-REVIEW-PROTOCOL.md 日報格式（轉述員工搜尋細節、缺口升級標記）
- [x] 7.6 重寫 GROWTH-REVIEW-PROTOCOL.md 週報格式（結構性缺口根因分析、應用率、學習來源）
- [x] 7.7 更新管理者指南（缺口升級規則執行責任、提案執行流程）
- [x] 7.8 [P] 同步更新 agents/general/schedules/daily-reflection.yaml prompt（Step 0 判斷 + 前日追蹤 + 搜尋記錄要求）
- [x] 7.9 [P] 同步更新 agents/coder/schedules/daily-reflection.yaml prompt
- [x] 7.10 [P] 同步更新 agents/admin/schedules/daily-reflection.yaml prompt
- [x] 7.11 同步更新 agents/admin/schedules/daily-growth-review.yaml prompt（缺口升級規則 + 如實轉述要求）

## 8. Audit Fixes & Configuration

- [x] 8.1 修復 daily-growth-review.yaml Phase 3-4 被 regex 誤刪（C1）
- [x] 8.2 所有員工反思排程改為 03:00，Admin 審查改為 04:00（C2）
- [x] 8.3 日報新增 copy-paste 提案審批指令塊（C3，Decision: Copy-paste 提案審批機制）
- [x] 8.4 日報/週報字數限制全部移除（W1，Decision: 報告字數不設上限）
- [x] 8.5 REFLECTION-PROTOCOL Phase 2 新增使用者回饋信號結構化提取（W2，Decision: 使用者回饋信號結構化提取）
- [x] 8.6 員工搜尋方向改為全球理論+成功案例+使用者素材庫（W3，Decision: 學習方向——全球理論 + 使用者素材庫）
- [x] 8.7 每週趨勢報告改為週一 05:00（W6）
- [x] 8.8 Admin 審查排程設定 model: opus，員工反思維持 model: sonnet（Decision: 模型分層——Opus vs Sonnet）
- [x] 8.9 清除所有檔案中殘留的舊時間引用（22:00/22:30/21:00 → 03:00/04:00/05:00）
- [x] 8.10 更新所有 OpenSpec artifacts（proposal/design/spec/tasks）反映最終設計

## 9. 排程合併：memory-digest → daily-reflection Phase 0

- [x] 9.1 REFLECTION-PROTOCOL.md 新增 Phase 0: Memory Cleanup（整合原 daily-memory-digest 操作）
- [x] 9.2 REFLECTION-PROTOCOL.md 修復日期邏輯（03:00 觸發 → 反思對象 = 昨天）
- [x] 9.3 更新 agents/general/schedules/daily-reflection.yaml（新增 Phase 0 + 日期修正）
- [x] 9.4 更新 agents/coder/schedules/daily-reflection.yaml（同上）
- [x] 9.5 更新 agents/admin/schedules/daily-reflection.yaml（同上）
- [x] 9.6 刪除 agents/general/schedules/daily-memory-digest.yaml
- [x] 9.7 刪除 agents/coder/schedules/daily-memory-digest.yaml
- [x] 9.8 刪除 agents/admin/schedules/daily-memory-digest.yaml
- [x] 9.9 刪除 agents/general/schedules/morning-summary.yaml（disabled）
- [x] 9.10 刪除 agents/admin/schedules/weekly-collaboration-review.yaml（disabled）
- [x] 9.11 更新管理指南機制全貌圖（移除 memory-digest 23:00）
- [x] 9.12 更新 design.md Decision: 排程時間安排（合併說明）

## 10. 整合驗證

- [x] 10.1 驗證 evolution/ 目錄在 AgentLoader 掃描時不造成驗證失敗（Agent 設定目錄結構 — evolution directory is optional）
- [x] 10.2 端對端測試：手動觸發一次 daily-reflection，確認五階段流程正常執行並產出 evolution/weekly/ 記錄
- [x] 10.3 端對端測試：手動觸發一次 weekly-growth-review，確認能讀取各 Agent evolution/ 並產出符合格式的週報
