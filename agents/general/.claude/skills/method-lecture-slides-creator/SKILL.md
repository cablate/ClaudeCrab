---
name: lecture-slides-creator
description: |
  講座簡報大綱生成器。將講座逐字稿 + 截圖轉化為「現場演講輔助」型簡報大綱。
  
  觸發情境：
  - 「幫我把這份逐字稿變成簡報」
  - 「根據講座內容產出 PPT 大綱」
  - 「這份講座需要哪些簡報頁面」
  - 「幫我規劃講座的投影片」
  - 任何「逐字稿 → 簡報」的轉換請求
  
  通常在 lecture-design 完成後使用。

  主動更新時機：完成一次簡報規格產出後將經驗追加至 references；發現新的頁面類型或視覺規格模式時更新對應 references 檔案；嘗試新的 AI 簡報工具後更新工作流程建議。
---

# Lecture Slides Creator 講座簡報生成器

## 核心定位

**現場演講輔助型簡報**：簡報是講者的提詞器和觀眾的記憶錨點，不是逐字稿的複製。

與「閱讀分享型簡報」的差異：

| 面向 | 閱讀分享型 | 現場演講型（本 Skill） |
|------|-----------|----------------------|
| 自明性 | 沒講者也能懂 | 依賴講者補充 |
| 文字量 | 多，傳達完整資訊 | 少，金句/關鍵詞為主 |
| 留白 | 少 | 多，給講者發揮空間 |

---

## 工作流程

### 輸入確認

1. **逐字稿來源**：確認檔案路徑或貼上的內容
2. **截圖資料夾**：確認 images/ 位置，列出可用截圖
3. **時間分配**：從逐字稿或 README 取得各階段預計時長

### 產出流程

```
1. 解析逐字稿 → 識別階段、金句、轉場點
2. 對照截圖 → 匹配截圖與對應內容
3. 規劃頁面 → 套用最佳實踐原則
4. 產出大綱 → Markdown 格式，含時間標記
```

---

## 頁面規劃原則

詳細原則見 [references/best-practices.md](references/best-practices.md)

### 速查表

| 內容類型 | 頁面處理 | 範例 |
|---------|---------|------|
| **金句** | 單獨一頁，大字置中 | 核心金句，一句話總結觀念 |
| **核心觀念** | 一頁一觀念，關鍵詞為主 | 概念 A vs 概念 B 對比 |
| **案例展示** | 截圖全版或半版 + 標題 | Before/After 對比截圖 |
| **流程/步驟** | 分頁或漸進呈現 | 3-5 步驟的流程圖 |
| **互動點** | 標記頁，提醒講者 | 「⏸️ 互動：[引導問題]」 |
| **轉場** | 簡潔過渡頁 | 「接下來：如何設計」 |

### 頁數估算

| 講座長度 | 建議頁數 | 平均每頁時長 |
|---------|---------|-------------|
| 60 分鐘 | 30-40 頁 | 1.5-2 分鐘 |
| 90 分鐘 | 45-60 頁 | 1.5-2 分鐘 |
| 120 分鐘 | 60-80 頁 | 1.5-2 分鐘 |

---

## 輸出格式

支援兩種輸出，見 [references/output-formats.md](references/output-formats.md)

### Mode A：Markdown 大綱（預設）

每頁包含：
- 頁碼與標題
- 內容類型標籤
- 主要內容
- 截圖指引（如有）
- 時間標記（對應逐字稿段落）
- 講者備註

### Mode B：視覺規格提示詞（推薦）

將 Mode A 的內容大綱轉化為「可執行的視覺製作規格」，手動複製給外部 AI 工具製作簡報。

**分離式架構**：

```
B-1：設計規範（產一次，全部通用）
    ├─ 配色方案
    ├─ 字體規範
    ├─ 版面原則
    ├─ 動畫原則
    └─ 頁面類型模板（9 種）

B-2：頁面規格（可分批產，套用 B-1）
    ├─ P1: 元素 + 進場順序 + 視覺處理
    ├─ P2: 元素 + 進場順序 + 視覺處理
    └─ ...
```

**執行順序**：
1. 先產 **B-1 設計規範**（選預設風格或自訂）
2. 再產 **B-2 頁面規格**（可分批：先 HOOK 8 頁，再下一階段 14 頁...）
3. 手動複製規格丟給 Gemini / Gamma / 其他 AI 簡報工具

詳細格式見 [references/visual-spec-format.md](references/visual-spec-format.md)
設計風格預設見 [references/design-presets.md](references/design-presets.md)

---

## 工作流程（完整版）

```
lecture-design          → 產出逐字稿（結構、金句、時間分配）
        ↓
lecture-slides-creator
    ├─ Mode A           → 簡報大綱（內容規劃）
    │       ↓
    └─ Mode B           → 視覺規格提示詞（製作規格）
                ↓
        複製規格丟給     → Gemini / Gamma / 其他 AI 簡報工具
        AI 工具製作
```

### 建議流程

1. **先產出 Mode A**：確認內容和頁面規劃
2. **選擇設計風格**：從預設中選擇或自訂
3. **產出 Mode B**：生成完整視覺規格提示詞
4. **手動複製規格丟給 AI 工具**：Gemini 等
5. **迭代修正**：針對不滿意的頁面產出修正規格

---

## 迭代修正流程

針對不滿意的頁面單獨產出修正規格，不需重新生成整份簡報。

詳細流程與格式見 [references/iteration-workflow.md](references/iteration-workflow.md)

---

## 何時更新這份 Skill

> **AI 主動更新規則**：以下情境發生時，AI 應主動提議更新，不需等使用者要求。

| 情境 | 更新什麼 | 操作 |
|------|----------|------|
| 完成一次簡報規格產出 | 對應 references 檔案 | 將經驗與改進追加為案例 |
| 發現新的頁面類型 | `references/best-practices.md` | 新增頁面類型與處理方式 |
| 嘗試新的 AI 簡報工具 | 工作流程段落 | 更新工具建議與注意事項 |
| 視覺規格格式需改進 | `references/visual-spec-format.md` | 調整格式規範 |
| 設計風格預設需擴充 | `references/design-presets.md` | 新增風格預設 |

### 更新原則

1. **實證驅動**：只收錄經過實際產出驗證的改進
2. **保留脈絡**：更新時標注「何時、因哪場講座發現」
3. **精簡為上**：SKILL.md 放流程與原則，細節放 references/

---

## References

- [best-practices.md](references/best-practices.md) - 講座簡報設計最佳實踐
- [output-formats.md](references/output-formats.md) - 輸出格式詳細規範（Mode A/B）
- [visual-spec-format.md](references/visual-spec-format.md) - Mode B 視覺規格提示詞格式
- [design-presets.md](references/design-presets.md) - 5 種設計風格預設
- [iteration-workflow.md](references/iteration-workflow.md) - 迭代修正流程與格式
