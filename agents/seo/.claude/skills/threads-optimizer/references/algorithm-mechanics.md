# Threads 演算法底層機制

> 基於 6 份 Meta 專利原文 + 公開資訊交叉驗證
> 最後更新：2026-03-10

---

## 三階段排名管線

每則貼文進入系統後，瞬間經歷：

### Stage 1: Gather Inventory（收集候選池）

- 收集所有公開貼文 + 你追蹤帳號的貼文
- 過濾違反社群守則的內容
- 這一步決定你的貼文「有沒有資格」被推

### Stage 2: Compute Signals（計算信號）

系統分析數百種信號，核心五大類：

| 信號類別 | 權重 | 包含什麼 |
|----------|------|----------|
| Engagement Velocity | ~40% | 發文後短時間內的互動速度（30 分鐘內 50 讚 > 24 小時 100 讚） |
| Completion Rate | ~25% | 使用者是否看完整則貼文（停留時間、滑動行為） |
| Conversation Quality | ~20% | 回覆的深度（來回對話 >> 表情符號）、回覆的長度和內容品質 |
| Network Relevance | ~10% | 內容與使用者興趣向量的匹配度、帳號的主題集群歸屬 |
| Freshness & Consistency | ~5% | 內容新鮮度 + 帳號的發文規律性 |

**關鍵**：「需要更多努力的互動權重更高」—— 深度回覆 > 按讚 > 瀏覽。

### Stage 3: Rank & Sort（排名排序）

- 為每則貼文計算綜合預測分數
- 預測「這個使用者看到這則貼文會不會互動」
- 分數高的排前面，低的沉下去

---

## 擴散模型：小池塘 → 大海

貼文發布後的擴散路徑：

```
發布 → 第一波：推給向量距離最近的小群體（~數百人）
     → 早期互動信號好？→ 第二波：擴散到稍遠的受眾
     → 持續表現好？→ 第三波：進入 For You 大規模分發
     → 早期互動差？→ 停止擴散，貼文基本死亡
```

**為什麼第一波這麼重要**：
- Engagement Velocity 佔 ~40% 權重
- 系統需要「證據」才會投入更多曝光資源
- 沒有早期信號 = 系統判定「這則內容對目標受眾沒吸引力」

---

## Meta 專利技術解析

### 1. 語意向量匹配（US10579688B2）

**原理**：系統將所有內容和使用者都表示為 **d 維嵌入空間中的向量**。

三層匹配：
- **Relevance Score**：貼文向量 vs 查詢/興趣向量的 cosine similarity
- **Personalization Score**：從使用者歷史互動重建偏好向量
- **Context Score**：結合 session 情境的動態向量

**對你的意義**：
- 你的每一則貼文都在定義系統對你的理解
- 用具體領域術語 → 向量更精確 → 匹配到更對的受眾
- 用模糊通用詞 → 向量模糊 → 推給不精準的人 → 互動差 → 惡性循環

### 2. 品質分級 + Clickbait 偵測（US20190095961A1）

**原理**：用 regression model 對內容做 1-5 連續品質評分。

偵測 Clickbait 的核心邏輯：
```
高點擊率 + 低使用者滿意度 = Low Signal = 被壓流量
```

**Low Signal 觸發條件**：
- 聳動開頭但內容空洞
- 情緒操縱（恐懼、憤怒、焦慮）但無實質
- AI 生成的典型誇張句型（「震驚！」「你絕對不知道」「99% 的人都錯了」）

**High Signal 特徵**：
- 點進來 + 看完 + 覺得值得
- 引發有深度的回覆（不是「好讚！」）
- 被分享給朋友（DM 發送是最高信號）

### 3. 主題集群（US10558714B2）

**原理**：系統用 ML classifier 將內容標記主題 → 組成 topic groups → 預測使用者對各主題的興趣度。

**集群建立**：
- 基於你的發文歷史 + 互動對象 + 受眾特徵
- 爆文會強化你在該主題集群的歸屬
- 跨主題發文會稀釋你的集群信號

**集群效應**：
- 被歸入「SEO 專家」集群 → 發 SEO 內容獲得大量推送
- 同一個人突然發美食內容 → 系統困惑 → 不知道推給誰 → 低流量
- 這就是為什麼很多人說「爆文什麼類型就一直發」

**動態調整**：排名會隨新互動數據更新，表現低於閾值的主題會被移除。

### 4. 社交圖譜加權（US9582786B2）

**原理**：排名模型基於 Social Graph 的連結強度加權。

三個維度：
1. **Viewer-to-Actor 關係**：觀看者與發文者的親密度、互動頻率
2. **Connection Activity**：與觀看者關係越近的人互動權重越高
3. **Authority Weight**：高影響力使用者（高追蹤、高互動率）的互動給更高排名分

**KOL 互動的放大效應**：
- 不是任何大帳號都有效
- 關鍵是**追蹤者圖譜重疊度**
- 美食 KOL 在你的 SEO 貼文按讚 → 效果微弱
- SEO 專家（即使粉絲少）在你的 SEO 貼文按讚 → 顯著放大

### 5. 外部連結評估（US10268763B2）

**原理**：建立 Enhanced Search Index，整合外部網頁 + 內部社交信號。

評分信號：
1. **社交圖譜距離**：分享者與觀看者的 degree of separation
2. **社交背書**：多少人分享過同一域名/URL
3. **互動品質比率**：觀看人數 vs 互動人數的比率
4. **主題相關性**：使用者歷史興趣是否與連結內容匹配

**域名信任度是有機累積的**：越多使用者分享、互動該域名 → 信任度越高。不是預設值。

---

## 與 Google SEO 的相似與差異

| 維度 | Google SEO | Threads |
|------|-----------|---------|
| 語意理解 | 神經網路計算語意關係 | 向量嵌入匹配（相同底層） |
| 主題權威 | Topic Authority + E-E-A-T | Topic Clustering + 集群歸屬 |
| 品質評估 | Helpful Content System | Quality Regression Model |
| 連結信號 | PageRank + 外部連結 | 社交圖譜 + 社交背書 |
| 核心差異 | 搜尋意圖匹配 | **互動速度和社交關係** |

darkseoking 說「跟 Google SEO 80% 像」——底層邏輯確實高度相似，但權重分配完全不同。Google 重搜尋意圖，Threads 重**即時互動和社交關係**。

---

## 參考來源

### 專利
- [US10579688B2](https://patents.google.com/patent/US10579688B2/en) — Semantic embedding 搜尋排名（2020，已過期）
- [US20190095961A1](https://patents.google.com/patent/US20190095961A1/en) — 品質分級模型（2019，已放棄）
- [US10558714B2](https://patents.google.com/patent/US10558714B2/en) — 主題集群排名（2020）
- [US9582786B2](https://patents.google.com/patent/US9582786B2/en) — 社交圖譜排名（2017）
- [EP2977948A1](https://patents.google.com/patent/EP2977948A1/en) — 外部內容排名（已撤回）
- [US10268763B2](https://patents.google.com/patent/US10268763B2/en) — 外部內容排名（2019）

### 公開資訊
- [RecurPost: Meta Threads Algorithm Explained (2026)](https://recurpost.com/blog/threads-algorithm/)
- [PostEverywhere: How the Threads Algorithm Works (2026)](https://posteverywhere.ai/blog/how-the-threads-algorithm-works)
- [PostEverywhere: How to Go Viral on Threads (2026)](https://posteverywhere.ai/blog/how-to-go-viral-on-threads)
- Adam Mosseri 官方聲明（Threads @mosseri）
