# 設計：共享知識區架構

## Decisions

### 共享區目錄結構

建立 `agents/_shared/knowledge/` 作為全域共享區，按 agentId 劃分子目錄（如 `general/`、`nitterbot/`）。

### 命名空間隔離與權限控制

- 讀取：所有 bot 可讀整個共享區
- 寫入：只能寫入自己的命名空間

### 私有區與發布機制

各 bot 維持 `knowledge/` 私有工作區作為草稿區，完成的內容由 bot 主動複製到共享區。

### 排除的替代方案

- 方案 A（請求-回應機制）：流程過於複雜，且需要排程或事件觸發
- 方案 B（直接開放跨 bot 讀取）：模糊隔離邊界，且 bot 可能讀到未完成的草稿
- 方案 C（中央知識庫）：命名衝突、來源追蹤困難

## Risks / Trade-offs

### 正面
- 保持工作區隔離原則
- Bot 可以選擇性發布，保護草稿和私有筆記
- 共享內容有明確的所有權（agentId 命名空間）

### 負面
- Bot 需要主動執行發布動作
- 共享區內容可能與私有區不同步

## Affected Components

```
agents/
├── _shared/
│   └── knowledge/
│       ├── general/          # general 發布的內容
│       └── nitterbot/        # nitterbot 發布的內容
├── general/
│   └── knowledge/            # 私有（原 tools/ + cases/）
└── nitterbot/
    └── knowledge/            # 私有
```
