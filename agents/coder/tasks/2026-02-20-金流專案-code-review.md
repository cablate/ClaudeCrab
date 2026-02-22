# 金流串接專案 Code Review

**專案**：金流串接（PAYUNi + ECPay 整合）
**審查日期**：2026-02-20
**審查重點**：架構清晰度、可讀性、維護擴充性（避免過度抽象）

---

## 總評

**整體評價：良好 ✓**

這是一個**規模適中的支付整合專案**，架構清晰、分層合理。程式碼風格一致，沒有過度抽象的問題。以目前規模來說，這樣的架構是**恰當且易於維護**的。

---

# Part 1: 後端 (src/)

## 1. 專案結構

```
src/
├── config/          # 配置集中管理
├── data/            # 靜態資料（商品）
├── middleware/      # Express 中間件
├── routes/          # 路由層（業務邏輯在此）
├── services/        # 服務層
│   ├── business/    # 業務服務
│   ├── database/    # 資料庫服務
│   │   └── repositories/
│   ├── invoice/     # 發票服務
│   └── payment/     # 金流 SDK
├── types/           # 型別定義（已併入 order-status）
└── utils/           # 工具函式
```

### ✓ 優點

- **分層清晰**：routes → services → repositories 結構明確
- **職責單一**：每個檔案做一件事
- **命名一致**：`createXxxRoutes`、`getXxxSDK`、`XxxRepository` 模式統一

---

## 2. 入口點 `index.ts`

**長度**：約 180 行
**評價**：✓ 適中

### ✓ 優點

- 結構化註解區塊（環境檢查、初始化、安全設定、路由掛載）
- 環境變數檢查完整，啟動時就驗證
- 錯誤處理完善（uncaughtException、unhandledRejection）

### ✅ 已修正

~~`oneTimeTokens` 使用 `any` 型別~~ → 已改為 `PaymentResultToken` 明確型別

---

## 3. 配置管理 `config/constants.ts`

**評價**：✓ 很好

- 所有配置集中一處
- 有清楚的 JSDoc 註解說明每個配置區塊
- `getRequiredEnvVars()` 動態判斷必要變數
- Sandbox/Production 不同 MerchantID 有註解說明

---

## 4. 金流 SDK

### `EcpaySDK.ts` & `PayuniSDK.ts`

**評價**：✓ 很好

| 面向 | 分析 |
|------|------|
| **封裝** | CheckMacValue 生成、驗證完全封裝在 SDK 內 |
| **介面** | `createPaymentForm()`、`validateAndParseWebhook()` 語義清晰 |
| **關注點分離** | SDK 只處理加解密和資料轉換，不碰業務邏輯 |

### ✓ 亮點

ECPay SDK 的 CheckMacValue 實作有處理 `%20` → `+` 的陷阱。

### `provider.ts` — 單例管理

**評價**：✓ 適當

延遲初始化、測試可重置，沒有 DI 容器，沒有 Factory Pattern，剛好夠用。

---

## 5. 發票服務 `EcpayInvoiceService.ts`

**評價**：✓ 良好

- 介面定義清晰（`IssueInvoiceParams`、`InvoiceResult`）
- 錯誤處理完善（回傳 `{ success, error, errorCode }`）
- 發票通知功能獨立方法

### ✅ 已修正

~~發票參數 hardcode 無註解~~ → 已加入詳細的參數選型說明註解

---

## 6. 資料庫層

### `Database` Facade

**評價**：✓ 適當的抽象

- **沒有過度抽象**：簡單的委派模式
- **好處**：routes 不需要知道有多少 Repository

### Repository Pattern

**評價**：✓ 良好

`OrderRepository` 有清晰的欄位定義（`COL` 常數），Google Sheets 欄位對應清楚。

---

## 7. 路由層

### `ecpay.ts`

**長度**：約 300 行
**評價**：✓ 可接受

- 冪等性處理正確
- `issueInvoiceAsync` 放在路由檔案內可接受（只有 ECPay webhook 用）

---

## 8. 錯誤處理

**評價**：✓ 很好

- 區分可重試 / 不可重試錯誤
- 錯誤碼標準化
- 統一錯誤處理中間件

---

## 9. 型別組織

**評價**：✓ 良好

### ✅ 已修正

~~`models/` 目錄只有一個檔案~~ → 已併入 `types/order-status.ts`

---

## 10. 安全性

| 項目 | 狀態 | 說明 |
|------|------|------|
| CSRF 防護 | ✓ | 使用 csurf，排除 webhook 路徑 |
| Rate Limiting | ✓ | 一般 200/15min，支付 5/min |
| Helmet | ✓ | CSP、HSTS 正確配置 |
| CheckMacValue | ✓ | SDK 內部驗證 |
| 冪等性 | ✓ | Webhook 重複處理檢查 |

---

# Part 2: 前端 (_frontend/)

## 1. 前端結構

```
_frontend/
├── index.html            # 主頁面（商品列表、結帳）
├── orders.html           # 訂單頁面
├── subscriptions.html    # 訂閱頁面
├── result.html           # 支付結果頁面
└── public/
    ├── js/
    │   ├── main.js       # 主應用進入點（模組化版本）
    │   └── modules/
    │       ├── auth.js       # 認證管理
    │       ├── payment.js    # 支付處理
    │       ├── products.js   # 商品管理
    │       └── ui.js         # UI 工具
    ├── result.js         # 結果頁邏輯
    ├── orders.js         # 訂單頁邏輯
    ├── subscriptions.js  # 訂閱頁邏輯
    └── style-serif.css   # 主題樣式
```

---

## 2. 模組化設計

**評價**：✓ 良好

### 模組職責

| 模組 | 職責 | 評價 |
|------|------|------|
| `auth.js` | 登入狀態、UI 更新 | ✓ 職責清晰 |
| `payment.js` | 建立支付、轉導 | ✓ 簡潔 |
| `products.js` | 商品載入、篩選、渲染 | ✓ 完整 |
| `ui.js` | loading、error、formatDate | ✓ 工具集中 |

### ✓ 優點

- 使用 ES Module（`import/export`）
- 每個模組單一職責
- 註解完整（JSDoc 風格）

---

## 3. 主應用 `main.js`

**長度**：約 350 行
**評價**：✓ 可接受

### 結構

```javascript
// DOM 元素集合（統一管理）
const elements = { ... };

// 管理器初始化
const authManager = new AuthManager();
const productManager = new ProductManager();
let paymentManager;

// Modal 控制
function openCheckoutModal() { ... }
function closeCheckoutModal() { ... }

// 事件監聯器綁定
elements.loginBtn?.addEventListener(...);

// 初始化
init();
```

### ✓ 優點

- DOM 元素統一集中在 `elements` 物件
- 使用 `?.` optional chaining 避免 null 錯誤
- 結構化註解區塊

---

## 4. ~~舊版 `app.js`~~ ✅ 已刪除

**評價**：~~⚠️ 討論點~~ → ✅ 已處理

### 問題（已解決）

- 與 `main.js` 功能重複
- 沒有模組化（全域變數）
- `index.html` 已改用 `main.js`，`app.js` 無人載入

### 執行結果

| 動作 | 說明 |
|------|------|
| 刪除 `_frontend/public/app.js` | 移除 ~320 行死碼 |

---

## 5. 支付流程 `payment.js`

**評價**：✓ 很好

```javascript
// 根據商品類型與金流選擇 API 端點
let endpoint;
if (product.type === "subscription") {
  endpoint = "/create-subscription";
} else if (product.gateway === "ecpay") {
  endpoint = "/create-ecpay-payment";
} else {
  endpoint = "/create-payment";
}
```

### ✓ 優點

- 相容 ECPay（`formAction/formParams`）與 PAYUNi（`payUrl/data`）
- 錯誤處理完善
- 程式碼簡潔

---

## 6. 商品管理 `products.js`

**評價**：✓ 良好

### 結構

```javascript
class ProductManager {
  products = [];
  selectedProductId = null;
  currentTab = "subscription";

  fetchProducts() { ... }
  setTab(tab) { ... }
  getFilteredProducts() { ... }
  selectProduct(id) { ... }
  renderProducts(container, currentUser, onSelect) { ... }
  _renderProductCard(...) { ... }  // 私有方法
}
```

### ✓ 優點

- 狀態管理集中
- `_` 前綴標示私有方法
- 渲染邏輯與資料邏輯分離

---

## 7. UI 工具 `ui.js`

**評價**：✓ 簡單夠用

```javascript
export function showLoading() { ... }
export function hideLoading() { ... }
export function showError(message) { ... }
export function clearError() { ... }
export function formatDate(dateString, options) { ... }
export function formatDateTime(dateString) { ... }
```

### ✓ 優點

- 純函式，無副作用
- 相容新舊 ID（`loading-overlay` / `loading-modal`）
- `formatDate` 統一管理日期格式化

---

## 8. 結果頁 `result.js`

**評價**：✓ 良好

- 成功/失敗狀態分開處理
- 使用 token 從後端取得結果
- 錯誤處理完善

---

## 9. HTML 結構

### `index.html`

**評價**：✓ 良好

- 語義化標籤（`<header>`、`<nav>`、`<main>`）
- 結構化註解區塊
- SVG icon 內嵌（不依賴外部）

### CSS 組織

| 檔案 | 狀態 |
|------|------|
| `style-serif.css` | ✓ 使用中 |
| ~~`style.css`~~ | ✅ 已刪除（Dark Mode 舊版） |
| ~~`landing.css`~~ | ✅ 已刪除（Landing Page 舊版） |

---

## 10. 前端安全性

| 項目 | 狀態 | 說明 |
|------|------|------|
| CSRF Token | ✓ | 每次請求帶 `X-CSRF-Token` |
| Turnstile | ✓ | 支付前驗證 |
| XSS 防護 | ✓ | 使用 `textContent` 而非 `innerHTML`（大部分） |

### ⚠️ 注意點

`products.js` 的 `_renderProductCard` 使用 `innerHTML`：

```javascript
card.innerHTML = `
  ${labelHtml}
  ${iconHtml}
  <h3 class="product-name">${product.name}</h3>
  ...
`;
```

**風險**：若 `product.name` 來自使用者輸入，可能有 XSS。

**現況**：商品資料來自後端靜態檔案，風險低。

**建議**：若未來支援使用者自訂商品名稱，需改用 `createElement` + `textContent`。

---

# Part 3: 已執行的修正

## 後端修正

| 項目 | 修改內容 |
|------|----------|
| `oneTimeTokens` 型別 | 新增 `PaymentResultToken` 介面，`Map<string, any>` → `Map<string, PaymentResultToken>` |
| 發票參數註解 | 在 `_buildInvoiceData` 加入 Print/CarrierType 選型說明 |
| `models/` 目錄 | 移動到 `types/order-status.ts`，刪除空目錄 |

## 前端修正

| 項目 | 修改內容 |
|------|----------|
| 刪除 `app.js` | 移除 ~320 行死碼 |
| 刪除 `style.css` | 移除 Dark Mode 舊版主題 |
| 刪除 `landing.css` | 移除 Landing Page 舊版主題 |
| `auth.js` 新增 export | `checkLoginStatus()` 和 `getCurrentUser()` 獨立函式 |
| `ui.js` 新增 export | `formatDate()` 和 `formatDateTime()` 工具函式 |
| `orders.js` 重構 | 改為 import 共用模組，移除重複邏輯 |
| `subscriptions.js` 重構 | 改為 import 共用模組，移除重複邏輯 |

## 檔案變更

```
src/types/common.ts            # 新增 PaymentResultToken 介面
src/types/order-status.ts      # 新增（從 models/ 移入）
src/types/models.ts            # 更新 import 路徑
src/index.ts                   # 更新 oneTimeTokens 型別
src/services/invoice/...       # 更新發票參數註解
src/models/                    # 已刪除
_frontend/public/app.js        # 已刪除（~320 行死碼）
_frontend/public/style.css     # 已刪除（舊版主題）
_frontend/public/landing.css   # 已刪除（舊版主題）
_frontend/public/js/modules/auth.js      # 新增 export 函式
_frontend/public/js/modules/ui.js        # 新增 formatDate/formatDateTime
_frontend/public/orders.js               # 重構，import 共用模組
_frontend/public/subscriptions.js        # 重構，import 共用模組
```

---

# 總結建議

## 後端

| 狀態 | 項目 |
|------|------|
| ✅ 已完成 | `oneTimeTokens` 型別 |
| ✅ 已完成 | 發票參數註解 |
| ✅ 已完成 | `models/` 併入 `types/` |

## 前端

| 優先級 | 項目 | 建議 |
|--------|------|------|
| ✅ 已完成 | `app.js` 死碼 | 已刪除 ~320 行無用程式碼 |
| ✅ 已完成 | `style.css` 死碼 | 已刪除舊版 Dark Mode 主題 |
| ✅ 已完成 | `landing.css` 死碼 | 已刪除舊版 Landing Page 主題 |
| ✅ 已完成 | 重複邏輯 | `orders.js`、`subscriptions.js` 改用共用模組 |
| 低 | `main.js` 可再拆分 | Modal 控制可抽成獨立模組 |
| 中 | `innerHTML` XSS 風險 | 若支援使用者輸入，需改用安全方式 |

## 日後擴充時考慮

| 時機 | 項目 | 做法 |
|------|------|------|
| 新增更多 webhook 需要開發票 | 抽出發票處理邏輯 | 建立 `services/business/invoice-handler.ts` |
| Database 方法超過 30 個 | 簡化 Facade | 直接暴露 `db.orders.xxx()` |
| 新增第三個金流商 | SDK 介面統一 | 考慮定義 `IPaymentSDK` 介面 |
| 前端頁面增多 | 模組細分 | 考慮 bundler（Vite/esbuild）|

---

## 結論

**後端**：架構良好，低優先級改進已全部完成。
**前端**：模組化做得好，有小改進空間但不影響功能。

**整體評價**：專案架構符合規模需求，可讀性高，維護成本低，可繼續迭代開發。
