# 共享知識區架構

## Why

Bot 在對話過程中會產出知識資產（工具評估、案例研究等），這些內容目前存放在各 bot 的私有目錄（如 `general/tools/`、`general/cases/`）。

隨著多 bot 架構發展，以及未來群組協作功能的規劃，出現了跨 bot 知識共享的需求：
- nitterbot 可能需要參考 general 整理的工具評估
- 多個 bot 協作時需要共享 context

但直接讓 bot 存取其他 bot 的工作區，違反「目錄即代理」的隔離原則。

## What Changes

建立 `agents/_shared/knowledge/` 作為全域共享區：

1. **命名空間隔離**：共享區按 agentId 劃分子目錄
2. **權限控制**：讀取 — 所有 bot 可讀整個共享區；寫入 — 只能寫入自己的命名空間
3. **私有區保留**：各 bot 維持 `knowledge/` 私有工作區作為草稿區
4. **發布機制**：完成的內容由 bot 主動複製到共享區

## Capabilities

- 保持工作區隔離原則
- Bot 可以選擇性發布，保護草稿和私有筆記
- 共享內容有明確的所有權（agentId 命名空間）
