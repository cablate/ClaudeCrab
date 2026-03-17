# Vector Memory（LanceDB）

向量記憶系統，基於 LanceDB + hybrid retrieval（vector + BM25），提供跨 session 的語意搜尋能力。

**與檔案記憶的關係**：向量記憶是**檢索層**，檔案記憶是**source of truth**。兩者互補，不互相取代。

## References

- [tools-reference.md](references/tools-reference.md) — 9 個 MCP tools 完整參數
- [retrieval-internals.md](references/retrieval-internals.md) — Hybrid 管線、Weibull decay 模型（debug 時載入）

---

## 何時使用向量記憶

| 場景 | 用什麼 | 說明 |
|------|--------|------|
| 任務中需要回想過去 | `memory_recall` | 語意搜尋比翻檔案快 |
| 學到可複用知識 | `memory_store` | 存入向量，未來可被召回 |
| 踩坑/教訓 | `memory_store` × 2 | 雙層：fact（技術）+ decision（原則） |
| 使用者偏好/決策 | `memory_store` | category: preference / decision |
| 工具失敗要重試 | 先 `memory_recall` | Recall before retry — 可能之前踩過同樣的坑 |
| 更正舊記憶 | `memory_update` | 保留歷史版本（preference/entity 自動 supersede） |
| 刪除錯誤記憶 | `memory_forget` | 支援 ID 或搜尋刪除 |

### 不用向量記憶的場景

- 每日工作紀錄 → `memory/日期.md`
- 使用者觀察 → `USER.md`
- 操作規則 → `CLAUDE.md` Lessons Learned
- 需要人類可讀的結構化文件 → 檔案系統

---

## 記憶衛生規則

1. **短而原子**：每條 < 500 chars，一個概念一條記憶
2. **不存對話摘要**：存提煉後的知識，不是「今天討論了 X」
3. **不重複存**：存之前先 `memory_recall` 確認沒有重複
4. **分類要準確**：用對 category，影響檢索品質

---

## Category 對照

| 語意 | category | importance | 典型場景 |
|------|----------|------------|---------|
| 使用者偏好 | `preference` | 0.8 | 「我偏好 TypeScript」 |
| 客觀事實 | `fact` | 0.7-0.8 | 「ClaudeCab 用 LanceDB 做向量記憶」 |
| 決策/原則 | `decision` | 0.85 | 「選 LanceDB 因為嵌入式免服務」 |
| 實體資訊 | `entity` | 0.7 | 「DeepInfra 是 embedding provider」 |
| 技能/方法 | `skill` | 0.8 | 「Remotion 動畫用 interpolate」 |
| 其他 | `other` | 0.5-0.7 | 不屬於以上的 |

---

## 雙層記憶存儲（踩坑必做）

每次踩坑或學到教訓，**立即**存兩條：

```
# 技術層（what happened）
memory_store(
  text="Windows 上 npm install LanceDB 需要 --ignore-scripts 再手動裝 native module",
  category="fact",
  importance=0.8
)

# 原則層（what to do next time）
memory_store(
  text="遇到 native module EPERM 錯誤時，先用 --ignore-scripts 安裝再單獨裝 platform-specific package",
  category="decision",
  importance=0.85
)
```

存完後 `memory_recall` 驗證可以搜到。
