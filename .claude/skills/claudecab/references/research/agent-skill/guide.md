# Agent Skill 實踐指南

> 如何在 ClaudeCab 中設計和使用 Agent Skills

---

## Skill 檔案結構

```
agents/{agentId}/.claude/skills/
├── {skill-name}/
│   ├── SKILL.md              # 入口（必須）
│   └── references/           # 詳細內容（可選）
│       ├── topic-a.md
│       └── topic-b.md
```

---

## SKILL.md 格式

```markdown
---
name: skill-name
description: 觸發描述。包含關鍵詞索引讓 LLM 知道何時調用。
---

# Skill 標題

## 簡要說明

一兩句話說明這個 skill 做什麼。

## 詳細內容

- 詳見 [references/topic-a.md](references/topic-a.md)
- 詳見 [references/topic-b.md](references/topic-b.md)
```

---

## Description 撰寫要點

### ✅ 好的 Description

```yaml
description: >
  Session 啟動必讀。定義核心行為規範：Startup Protocol、
  Memory System（Pattern 追蹤、ACTIVE.md、檔案分工）、
  Safety、Guidelines。觸發時機：每次 session 開始時。
```

**特點**：
- 說明「何時使用」（Session 啟動必讀）
- 包含關鍵詞索引（Pattern、ACTIVE.md...）
- 不解釋定義，只列名稱

### ❌ 差的 Description

```yaml
description: 定義 agent 的行為規範。
```

**問題**：
- 太籠統，LLM 無法判斷何時觸發
- 沒有關鍵詞，問到相關概念時無法聯想

---

## ClaudeCab 核心 Skills

### agent-protocols

**用途**：定義 agent 怎麼做事

**結構**：
```
agent-protocols/
├── SKILL.md
└── references/
    ├── startup-protocol.md   # 啟動流程
    ├── behavior.md           # 行為規範（安全+準則+輸出格式）
    ├── memory-system.md      # 記憶寫入規則
    └── scheduling.md         # 排程建立指引
```

### persona

**用途**：定義 agent 是誰

**結構**：
```
persona/
├── SKILL.md
└── references/
    ├── soul.md               # 核心價值觀、說話風格
    └── identity.md           # 名字、角色、定位
```

**可攜帶性**：複製整個 `persona/` 目錄到其他 agent 即可部署相同人格。

---

## CLAUDE.md 與 Skills 的分工

| 內容 | 放哪裡 |
|------|--------|
| 「在回覆前，先調用 /agent-protocols」 | CLAUDE.md |
| Startup Protocol 的具體步驟 | skills/agent-protocols/references/ |
| Memory System 的寫入規則 | skills/agent-protocols/references/ |
| 人格定義 | skills/persona/references/ |
| 環境狀態（USER.md、MEMORY.md） | agent 根目錄 |

---

## SDK 設定

確保 `settings.local.json` 包含：

```json
{
  "permissions": {
    "allow": ["Skill", "Read", "Write", "..."]
  }
}
```

**注意**：`"Skill"` 工具必須在 allow 清單中，否則 agent 無法調用 skills。

---

## 除錯技巧

### Skill 未被觸發

1. 檢查 description 是否包含相關關鍵詞
2. 確認 `settings.local.json` 的 `allow` 包含 `"Skill"`
3. 確認使用 `settingSources: ['project']`（v1.11.0+）

### Skill 內容未載入

1. 確認 SKILL.md 存在且格式正確
2. 確認 references/ 路徑正確
3. 檢查 SKILL.md 是否有正確引用 references/

---

*相關文件：[design.md](design.md)*
