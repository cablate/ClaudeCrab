# 台灣電子發票串接研究

> 研究日期：2026-02-19
> 目的：金流串接測試專案加入電子發票功能，購買成功後自動開票

---

## 結論：推薦使用綠界 ECPay

綠界是目前台灣最適合開發者串接的電子發票服務，原因：
- **有完整 Sandbox 測試環境**，不需要走財政部正式申請流程
- 有 TypeScript / Node.js 套件（`node-ecpay-aio`）
- 開立發票後綠界自動幫你上傳財政部，不用自己串 Turnkey
- 官方文件完整、社群資源多

---

## 服務商比較

### ✅ 綠界 ECPay（推薦）

| 項目 | 說明 |
|---|---|
| Sandbox | ✅ 有，`https://einvoice-stage.ecpay.com.tw` |
| Node.js SDK | ✅ `node-ecpay-aio`（TypeScript 支援） |
| 申請難度 | 低，一般商家申請即可 |
| 財政部上傳 | 自動（48 小時內），不需自行串接 |
| 文件品質 | ✅ 完整 |

**Sandbox API Endpoint：**
- 開立發票：`https://einvoice-stage.ecpay.com.tw/Invoice/Issue`
- 查詢發票：`https://einvoice-stage.ecpay.com.tw/Query/Issue`

**測試 MID**：`2000132`

---

### 藍新金流 NewebPay

| 項目 | 說明 |
|---|---|
| Sandbox | ✅ 有，`https://cwww.newebpay.com` |
| Node.js SDK | 有第三方 SDK（非官方） |
| 申請難度 | 中，需審核（審核較慢，建議聯繫客服） |
| 電子發票 | 有支援，但文件不如綠界完整 |

---

### ❌ 財政部官方 API（直接串）

- **個人開發者無法申請**（2025 起需 ISO27001 認證）
- 門檻極高，不適合測試用途

---

## 串接方式（綠界 ECPay）

### 安裝套件

```bash
npm install node-ecpay-aio
```

> ⚠️ 官方 ECPay SDK 的 `gen_chk_mac_value` 有 bug，**不要用官方 SDK**，改用 `node-ecpay-aio`（自動處理 CheckMacValue）

---

### 購買成功後自動開票流程

```
① 使用者完成購買（金流交易成功）
② 後端收到金流成功回調（notify URL）
③ 呼叫綠界電子發票 API → Issue
④ 綠界開立發票，48 小時內自動上傳財政部
⑤ 以 Email 通知使用者發票資訊
```

---

### 開立發票 API 必要參數

| 參數 | 說明 |
|---|---|
| `MerchantID` | 商店代號（Sandbox: `2000132`）|
| `RelateNumber` | 廠商自訂編號（唯一，對應訂單 ID）|
| `CustomerEmail` | 買方 Email（用來通知發票）|
| `SalesAmount` | 發票金額（含稅）|
| `Items` | 商品明細（名稱、數量、單價）|
| `TaxType` | 課稅類別（1=應稅）|
| `InvType` | 字軌類別（07=一般稅額）|
| `CheckMacValue` | 驗證碼（套件自動計算）|

---

### 程式碼範例（TypeScript）

```typescript
import { Invoice } from 'node-ecpay-aio';

const invoice = new Invoice({
  MerchantID: '2000132',  // Sandbox MID
  HashKey: 'YOUR_HASH_KEY',
  HashIV: 'YOUR_HASH_IV',
  isStage: true,  // 切換 Sandbox
});

const result = await invoice.issue({
  RelateNumber: `ORDER_${orderId}`,
  CustomerEmail: user.email,
  SalesAmount: orderTotal,
  InvType: '07',
  TaxType: '1',
  Items: [
    {
      ItemName: productName,
      ItemCount: 1,
      ItemWord: '式',
      ItemPrice: orderTotal,
      ItemTaxType: '1',
      ItemAmount: orderTotal,
    }
  ],
});
```

---

### CheckMacValue 計算邏輯（手動實作參考）

```typescript
import * as crypto from 'crypto';

function generateCheckMacValue(
  params: Record<string, string | number>,
  hashKey: string,
  hashIV: string
): string {
  const { CheckMacValue: _, ...rest } = params as any;

  // 1. 依 Key 字母排序
  const sortedKeys = Object.keys(rest).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  // 2. 組合字串
  const paramStr = sortedKeys.map((key) => `${key}=${rest[key]}`).join('&');
  const raw = `HashKey=${hashKey}&${paramStr}&HashIV=${hashIV}`;

  // 3. URL Encode 轉小寫，還原特殊字元（對齊 .NET 行為）
  let encoded = encodeURIComponent(raw).toLowerCase()
    .replace(/%21/g, '!').replace(/%28/g, '(').replace(/%29/g, ')')
    .replace(/%2a/g, '*').replace(/%2d/g, '-').replace(/%2e/g, '.')
    .replace(/%5f/g, '_');

  // 4. SHA256 轉大寫
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}
```

> **建議直接用 `node-ecpay-aio`，不要手動算**

---

## 申請流程

1. 至 [綠界後台](https://merchant.ecpay.com.tw) 申請帳號
2. 開立商店，取得 `MerchantID`、`HashKey`、`HashIV`
3. 申請電子發票服務（綠界免費協助申辦，可代申請財政部字軌）
4. Sandbox 直接用 MID `2000132` 測試，無需申請

---

## 參考資源

| 資源 | 連結 |
|---|---|
| ECPay 開發者文件 | https://developers.ecpay.com.tw |
| B2C 電子發票 API 文件 | https://developers.ecpay.com.tw/?p=7809 |
| 開立發票 API | https://developers.ecpay.com.tw/?p=24230 |
| 測試環境資訊 | https://developers.ecpay.com.tw/?p=7849 |
| node-ecpay-aio（npm） | https://www.npmjs.com/package/node-ecpay-aio |
| node-ecpay-aio（GitHub） | https://github.com/simenkid/node-ecpay-aio |
| Rails 串接教學（邏輯通用） | https://5xcampus.com/posts/rails-ecpay.html |
