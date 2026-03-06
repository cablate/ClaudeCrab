## 1. _example 模板更新（Decision 1：標準目錄結構定義 + Decision 6：協議文件更新策略）

- [x] 1.1 更新 `_example/CLAUDE.md` 目錄結構參考表，落實 Standard Agent Directory Structure：新增 output/、plans/、schedules/，更新 knowledge/ 描述為「知識暫存區」，新增 evolution/reviews/
- [x] 1.2 [P] 更新 `_example/.claude/rules/self-evolution.md` Layer 1 清單，落實 Three-Layer Permission Model：新增 output/、plans/ 為自由讀寫區
- [x] 1.3 [P] 更新 `_example/.claude/skills/sys-agent-protocols/references/memory-system.md` 檔案系統表：新增 output/、plans/ 目錄描述
- [x] 1.4 [P] 更新 `_example/.claude/skills/sys-agent-protocols/references/behavior.md` 路徑權限表：新增 output/、plans/ 權限

## 2. 知識暫存區定義（Decision 2：knowledge/ 嚴格定義為知識暫存區）

- [x] 2.1 更新 `_example/.claude/skills/sys-self-evolution/SKILL.md` 知識分類表，落實 Knowledge Directory as Staging Area：明確定義可放/不可放的內容分類
- [x] 2.2 更新 `_example/evolution/REFLECTION-PROTOCOL.md` Phase 4 知識內化路徑，落實 Knowledge Lifecycle Management：加入歸納標記機制 `<!-- consolidated into {skill-name} -->`

## 3. 進化目錄擴展（Decision 4：evolution/ 擴展為完整的進化目錄）

- [x] 3.1 在 `_example/evolution/` 建立 reviews/ 目錄結構（reviews/daily/ + reviews/weekly/），落實 Evolution Directory Structure 擴展（Evolution Directory Extended Structure）

## 4. 產出與規劃目錄（Decision 3：output/ 標準化為所有 agent 的交付目錄 + Decision 5：plans/ 納入標準模板）

- [x] 4.1 在 `_example/` 建立 output/ 和 plans/ 目錄，落實 Output Directory Standardization 和 Plans Directory in Standard Template

## 5. 各 Agent CLAUDE.md 更新

- [x] 5.1 [P] 更新 `agents/general/CLAUDE.md` 目錄結構參考表（與 1.1 同步）
- [x] 5.2 [P] 更新 `agents/coder/CLAUDE.md` 目錄結構參考表（與 1.1 同步）
- [x] 5.3 [P] 更新 `agents/admin/CLAUDE.md` 目錄結構參考表（與 1.1 同步）

## 6. 各 Agent 目錄結構補齊

- [x] 6.1 [P] general：確認 output/ 存在，建立 plans/
- [x] 6.2 [P] coder：確認 plans/ 存在，建立 output/
- [x] 6.3 [P] admin：建立 output/、plans/
- [x] 6.4 [P] admin：將 knowledge/growth-reviews/ 遷移到 evolution/reviews/

## 7. 現有檔案遷移

- [x] 7.1 general：審計 knowledge/ 中的非知識檔案，將交付物移到 output/
- [x] 7.2 admin：將 knowledge/agent-changes-log.md 移到適當位置（Skill references 或 evolution/）

## 8. Skill 路徑引用檢查

- [x] 8.1 搜尋所有 SKILL.md 中硬編碼的 knowledge/ 路徑引用，確認遷移後仍然正確

## 10. 遷移補完（Review 發現的遺漏）

- [x] 10.1 admin：將 `knowledge/self-evolution-management-guide.md` 移到 `agent-management` skill references/（管理方法論，不是暫存知識）
- [x] 10.2 admin：將 `knowledge/memory-lancedb-pro-analysis.md` 移到 output/（技術分析報告）
- [x] 10.3 [P] general：`knowledge/turboscribe-api-complete.md` 經確認為 general 研究的工具知識（dom-turboscribe skill 在 transcriber 不在 general），留在 knowledge/ 正確
- [x] 10.4 [P] general：審計 `knowledge/research/` 中的非知識檔案，交付物移到 output/

## 11. 交叉引用修正

- [x] 11.1 [P] 更新 `_example/.claude/rules/serena-tools.md` 記憶搜尋路徑：新增 output/、plans/
- [x] 11.2 [P] 更新 `_example/.claude/rules/self-evolution.md` Layer 1 描述一致性：knowledge/ 改為「知識暫存區」、output/ 改為「交付產出」
- [x] 11.3 [P] 更新 `_example/CLAUDE.md` 核心原則第 6 條：「知識庫先查」改為同時涵蓋 knowledge/ 和相關 skill references/
- [x] 11.4 更新 admin 其他檔案中 `knowledge/agent-changes-log.md` 的殘留引用

## 12. 知識歸納觸發機制

- [x] 12.1 在 REFLECTION-PROTOCOL.md 中新增知識歸納掃描步驟：反思時主動掃描 knowledge/ 既有檔案，評估是否有可歸納的知識群

## 13. 最終驗證

- [x] 13.1 確認 knowledge/ 中只剩純知識暫存檔案
- [x] 13.2 確認所有協議文件中的描述用語一致（暫存區、交付產出）
- [x] 13.3 確認已無殘留的舊路徑引用

## 14. 第二輪 Review 修復

- [x] 14.1 修正 `_example/evolution/GROWTH-REVIEW-PROTOCOL.md` 中 3 處 `knowledge/growth-reviews/` → `evolution/reviews/`