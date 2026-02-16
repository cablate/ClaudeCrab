# 共享知識區架構

## 概述

`agents/_shared/knowledge/` 是跨 Agent 的知識共享區，讓 bot 產出的知識資產可以被其他 bot 參考使用，同時保持工作區隔離原則。

## 目錄結構

```
agents/
├── _shared/
│   └── knowledge/
│       ├── general/          # general 發布的內容
│       │   ├── tools/
│       │   ├── cases/
│       │   ├── early-stage-fundraising-handbook.md
│       │   └── ganttai-fundraising-audit-report.md
│       └── nitterbot/        # nitterbot 發布的內容（目前為空）
│
├── general/
│   └── knowledge/            # general 私有工作區
│       ├── tools/
│       ├── cases/
│       └── research/
│
└── nitterbot/
    └── knowledge/            # nitterbot 私有工作區（尚未建立）
```

## 權限規則

| 路徑 | 讀取 | 寫入 |
|------|------|------|
| `_shared/knowledge/{agentId}/` | 所有 bot | 只有該 agentId |
| `_shared/knowledge/` 其他 | 所有 bot | 禁止 |
| `{agentId}/knowledge/` | 該 bot | 該 bot |
| 其他 bot 的私有區 | **禁止** | **禁止** |

## 產出流程

### 1. 私有產出

Bot 在自己的 `knowledge/` 目錄產出草稿或個人筆記：

```
knowledge/
├── tools/edge-tts.md       # 工具評估草稿
└── cases/crisis-pr.md      # 案例研究進行中
```

### 2. 發布共享

當內容完成且具有共享價值，複製到共享區：

```bash
# Bot 執行
cp knowledge/tools/edge-tts.md ../_shared/knowledge/{agentId}/tools/
```

### 3. 引用使用

其他 bot 可以從共享區讀取：

```
../_shared/knowledge/general/tools/edge-tts.md
../_shared/knowledge/nitterbot/cases/...
```

## Knowledge 檔案分類

| 目錄 | 內容 | 範例 |
|------|------|------|
| `tools/` | 工具評估、使用心得 | edge-tts.md, posty-ai.md |
| `cases/` | 案例研究、經驗分析 | jianan-goat-milk-crisis.md |
| `research/` | 主題研究筆記 | market-trends.md |

## 與記憶系統的區別

| 系統 | 目的 | 共享性 |
|------|------|--------|
| **Memory**（MEMORY.md, memory/） | 個人記憶、對話 context | 私有 |
| **Knowledge**（knowledge/） | 知識產出、可複用資產 | 可共享 |

## 設計原則

1. **隔離優先** — 預設私有，主動發布才共享
2. **命名空間** — 共享區用 agentId 分隔，避免衝突
3. **只讀保護** — 不能修改其他 bot 發布的內容
4. **向後相容** — 現有 bot 不強制使用共享區

## 未來擴展

### 群組共享區

```
agents/
├── _groups/
│   └── {groupId}/
│       └── shared/           # 群組專屬共享
```

群組共享區將在群組協作功能實作時加入。
