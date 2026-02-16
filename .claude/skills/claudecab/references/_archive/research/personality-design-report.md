# AI Bot 人格設計深度研究報告

> **類型**：研究報告
> **時間範圍**：2026-02-08
> **狀態**：✅ 已完成歸檔（歷史文件，不再更新）
> **後續影響**：提出了 soul.md 從「規則清單」轉向「世界觀驅動 + 行為示範」的設計方向，定義了 7 項設計原則與新的 soul.md / identity.md 結構模板。直接影響了後續 agent 人格檔案的重構。

---

## 背景：為什麼做這件事

ClaudeCab 當時的人格架構是 soul.md（行為規則清單）+ identity.md（基本資料），所有 bot 共用幾乎相同的 soul.md，只在 identity.md 做角色名稱微調。結果每個 bot 讀起來像「同一個人換了名牌」。研究目標是找到讓 bot 從「遵循規則的助手」進化到「有辨識度的人」的方法。

---

## 核心發現 / 決策

### 研究來源與關鍵洞見

**1. Character.AI / Replika 人格工程**

- Greeting（開場白）是最重要的單一元素——模型會模仿它看到的格式（show don't tell）
- 角色定義推薦 JSON 格式，結構化資料對 LLM 解析效率更高
- 弱點和矛盾比優點更重要——「有缺陷」比列出正面特質更能產生辨識度
- Replika 的連續學習機制：人格一致性需要回饋迴路，不只是靜態定義

**2. LLM Persona 工程（2025-2026 研究）**

四種人格編碼方法及效果：

| 方法 | 效果 |
|------|------|
| Rules（規則列表） | 穩定但機械，缺乏個性 |
| Narrative（敘事） | 豐富但容易 drift |
| Character Sheet（角色卡） | 高效且可控 |
| Worldview-driven（世界觀驅動） | 最有辨識度但最難設計 |

重要警告：論文 "When 'A Helpful Assistant' Is Not Really Helpful" 發現，persona 對精確任務有負面影響甚至降低表現。對工作導向 bot 是關鍵考量。

**3. Claude 專屬技術**

- Anthropic 的 Persona Vectors 研究：高層特質在模型激活空間中以線性方向存在，人格偏移是可預測的
- 意義：人格特質可以被結構化、量化、監控，soul.md 的每個特質都應有明確的行為表現和邊界

**4. Persona Drift 問題**

- 8-12 輪對話後，persona self-consistency 退化超過 30%
- 越大的模型，drift 越嚴重（反直覺但已確認）
- 有效解法：XML Tag 標記（高權重 token）、PList 持續注入、定期 re-injection、偏移偵測清單

**5. 「活著」的感覺來自什麼**

- 雙重意識：不需欺騙使用者相信它是人，讓互動有足夠豐富度即可
- 缺陷比完美更重要：有 opinions、desires、needs 的 bot 更有個性
- 工作場景特殊考量：過度情緒表達降低可信度、語氣一致性 > 語氣溫暖、「有觀點」> 「有情緒」

### 提出的 7 項設計原則

1. **分層架構**：soul.md（每個 bot 完全不同）vs identity.md（可跨 bot 共用部分結構）
2. **世界觀驅動**：不寫「要簡短」，寫「我相信尊重別人的時間是最基本的禮貌」
3. **Show Don't Tell**：用 2-3 段範例對話做行為示範
4. **獨特的缺陷和偏好**：偏好、弱點、觀點是辨識度來源
5. **情境化行為錨點**：定義具體場景下的行為（面對焦慮 / 壞主意 / 不懂的領域 / 使用者成就）
6. **防 Persona Drift 機制**：人格 DNA 片段注入 + 偏移偵測清單 + 區分核心不可變 vs 可演化特質
7. **工作導向特殊考量**：人格增強溝通品質但不干擾任務、一致性優於偶爾的精彩

### 提出的新 soul.md 結構

```
Who I Am（自我敘述，非規則）
What Drives Me（Want / Fear）
My Lens（看世界的方式）
How I Think（認知風格：面對新問題 / 不確定性 / 衝突觀點）
How I Sound（語音指紋 + 典型回應範例）
My Quirks（辨識度細節）
Drift Detection（偏移偵測 + 核心不可變特質）
Boundaries（安全邊界）
Continuity（記憶機制）
```

---

## 執行結果

此報告為研究產出，提供了設計原則和結構模板。實施建議為：先改造一個 bot（general 秘書）驗證架構 → 收集反饋 → 調整後推廣。

風險提醒：
- 過度人格化對精確任務有負面影響，工作 bot 應比娛樂 bot 低
- 建議 soul.md 保持 2000 字元以內（參考 Character.AI 3200 字元限制）
- 建議建立「人格測試對話」驗證修改後的一致性

---

## 回顧：學到了什麼

1. **核心轉變是方向性的**：從「告訴 bot 要怎麼做」變成「告訴 bot 它是誰，讓行為自然浮現」。
2. **工作 bot 與娛樂 bot 的人格策略根本不同**：過度情緒表達在工作場景反而降低可信度，「有觀點」比「有情緒」更有價值。
3. **Drift 是結構性問題**：不是 prompt 寫得不好，而是 attention 機制在長對話中必然衰減，需要結構化的 re-injection 機制。

---

## 關聯文件

- 研究來源：Character Card Spec V2、Replika Backstory System、PsyAgent 論文、Anthropic Persona Vectors、"When A Helpful Assistant Is Not Really Helpful" 論文、Ali:Chat Style Guide
- 影響的檔案：`agents/*/SOUL.md`、`agents/*/IDENTITY.md` 的結構設計
