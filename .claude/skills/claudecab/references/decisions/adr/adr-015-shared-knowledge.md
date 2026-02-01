# ADR-015: 共享知識區架構

## 狀態

已採納（2026-02-01）

## 背景

Bot 在對話過程中會產出知識資產（工具評估、案例研究等），這些內容目前存放在各 bot 的私有目錄（如 `general/tools/`、`general/cases/`）。

隨著多 bot 架構發展，以及未來群組協作功能的規劃，出現了跨 bot 知識共享的需求：
- nitterbot 可能需要參考 general 整理的工具評估
- 多個 bot 協作時需要共享 context

但直接讓 bot 存取其他 bot 的工作區，違反「目錄即代理」的隔離原則。

## 決策

建立 `agents/_shared/knowledge/` 作為全域共享區：

1. **命名空間隔離**：共享區按 agentId 劃分子目錄
2. **權限控制**：
   - 讀取：所有 bot 可讀整個共享區
   - 寫入：只能寫入自己的命名空間
3. **私有區保留**：各 bot 維持 `knowledge/` 私有工作區作為草稿區
4. **發布機制**：完成的內容由 bot 主動複製到共享區

## 目錄結構

```
agents/
├── _shared/
│   └── knowledge/
│       ├── general/          # general 發布的內容
│       └── nitterbot/        # nitterbot 發布的內容
│
├── general/
│   └── knowledge/            # 私有（原 tools/ + cases/）
│
└── nitterbot/
    └── knowledge/            # 私有
```

## 考慮的替代方案

### A. 請求-回應機制
Bot 不直接讀取，而是透過檔案協議請求內容。

**否決原因**：流程過於複雜，且需要排程或事件觸發。

### B. 直接開放跨 bot 讀取
允許 bot 讀取其他 bot 的 knowledge/ 目錄。

**否決原因**：模糊隔離邊界，且 bot 可能讀到未完成的草稿。

### C. 中央知識庫
所有 bot 共用單一 knowledge 目錄。

**否決原因**：命名衝突、來源追蹤困難。

## 後果

### 正面
- 保持工作區隔離原則
- Bot 可以選擇性發布，保護草稿和私有筆記
- 共享內容有明確的所有權（agentId 命名空間）

### 負面
- Bot 需要主動執行發布動作
- 共享區內容可能與私有區不同步

## 相關

- ADR-008: 記憶系統設計
- ADR-002: Agent 目錄隔離
- [system/shared-knowledge.md](../system/shared-knowledge.md)
