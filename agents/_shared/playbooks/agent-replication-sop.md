# Agent 複製 SOP

> 適用情境：從現有 agent 複製完整能力到新 agent（非從零新建）
> 首次實踐：2026-03-12 Coder → oss-coder

---

## 前提條件

- 確認來源 agent 的完整目錄結構
- 確認新 agent 的 ID（目錄名稱）和顯示名稱
- 確認新 agent 的 model 設定（預設跟來源相同或指定）

---

## Phase 1：基礎結構

1. **建立目錄** `agents/{new-agent-id}/`
2. **agent.json**：
   - 從來源複製，修改 `name` 為新名稱
   - `telegramBotToken` 設為空字串（待 Cab 提供）
   - `model` 依需求設定
3. **.mcp.json**：直接複製（MCP 工具配置通常相同）
4. **CLAUDE.md**：直接複製（Lessons Learned 是通用操作經驗，保留完整）

---

## Phase 2：Skills 複製

1. **全量複製** 來源 agent 的 `.claude/skills/` 目錄
2. **修改 persona**：
   - `identity.md`：修改 `Name` 和 `Creature` 為新 agent 的身份
   - `soul.md`：保持不動（人格特質通用）
3. **驗證**：確認所有 SKILL.md 都有正確的 frontmatter

---

## Phase 3：知識遷移

### 複製項目

| 項目 | 處理方式 |
|------|----------|
| `knowledge/` | 全量複製（含子目錄） |
| `USER.md` | 直接複製（使用者資訊通用） |
| `schedules/` | 複製排程定義 |
| `MEMORY.md` | **去個人化後複製**（見下方） |

### MEMORY.md 去個人化規則

**保留**：
- User Preferences（使用者偏好 — 通用）
- Key Decisions（架構決策 — 通用知識）
- Recurring Patterns（行為模式 — 通用經驗）

**移除**：
- Personality Journal（個人成長日記 — 專屬於來源 agent 的經歷）
- 任何包含「我和使用者之間」的個人互動回憶

### 不複製項目

| 項目 | 原因 |
|------|------|
| `memory/` 日誌 | 來源 agent 的每日工作記錄，與新 agent 無關 |
| `evolution/` | 來源 agent 的反思歷史 |
| `ACTIVE.md` | 來源 agent 的當前任務狀態 |
| `output/` | 來源 agent 的交付產出 |
| `plans/` | 來源 agent 的任務規劃 |
| `groups/` | 來源 agent 的群組對話 |

---

## Phase 4：Growth Profile

1. **複製** `growth-profile.md`
2. **重置**：
   - 當前階段設為 Phase 1
   - 三階段定義保持相同（成長路徑一致）
   - Growth signals 和 Professional principles 保持相同
3. **更新提取日期**

---

## Phase 5：收尾

1. **建立空目錄**（如需要）：`memory/`、`output/`、`plans/`、`playbooks/`
2. **記錄到 agent-changes-log.md**
3. **通知相關人員**（秘書更新組織架構文件）
4. **待辦追蹤**：telegramBotToken 需要 Cab 提供

---

## 複製 vs 新建的差異

| 維度 | 複製 | 新建 |
|------|------|------|
| Skills | 全量複製來源 agent | 只裝 sys-* 基礎 skills |
| Knowledge | 全量複製 | 空白或從相關來源挑選 |
| MEMORY.md | 去個人化後複製 | 空白模板 |
| CLAUDE.md | 直接複製（含 Lessons Learned） | 依角色從零撰寫 |
| Persona | 改名，保留人格 | 依角色設計或無 persona |
| Growth Profile | 複製並重置 Phase | 依角色新建或從 Employee Profile 提取 |

---

## Checklist

- [ ] Phase 1：目錄、agent.json、.mcp.json、CLAUDE.md
- [ ] Phase 2：skills 全量複製、identity.md 改名
- [ ] Phase 3：knowledge/、USER.md、MEMORY.md（去個人化）、schedules/
- [ ] Phase 4：growth-profile.md（重置 Phase）
- [ ] Phase 5：agent-changes-log、通知、追蹤待辦
