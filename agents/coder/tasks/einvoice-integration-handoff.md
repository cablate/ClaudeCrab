# 電子發票整合 — 交接文件

## 任務目標

在金流串接測試專案中，實作電子發票自動開立功能：
- 使用者購買成功 → 自動呼叫 ECPay 電子發票 API → 開立發票 → Email 通知使用者

---

## 背景研究（已完成）

研究文件位置：`agents/coder/knowledge/einvoice-integration-research.md`

### 核心決策

- **供應商選擇**：ECPay（綠界科技）
- **測試環境**：Sandbox mode（`https://einvoice-stage.ecpay.com.tw`）
- **測試 MID**：`2000132`
- **Node.js 套件**：`node-ecpay-aio`（避免官方 SDK 的 CheckMacValue bug）

### 技術要點

- B2C 電子發票流程：交易成功 → API 呼叫 → 綠界上傳財政部（48h 內）→ Email 通知
- 必要參數：`RelateNumber`（訂單編號）、`CustomerEmail`、`SalesAmount`、`Items`
- CheckMacValue：SHA256 雜湊驗證（套件自動處理）

---

## 專案資訊

- **專案名稱**：金流串接
- **專案路徑**：`E:\CabLate_Obsidian\01_專案Projects\付費內容規劃\金流串接`
- **技術棧**：TypeScript

---

## 實作範圍

### Phase 1: 整合準備
- [ ] 審查現有購買流程程式碼
- [ ] 安裝 `node-ecpay-aio` 套件
- [ ] 設定環境變數（HashKey, HashIV）

### Phase 2: API 整合
- [ ] 建立 ECPay Invoice 設定（Sandbox 模式）
- [ ] 在購買成功 handler 中加入發票開立邏輯
- [ ] 實作錯誤處理（API 失敗時的 fallback）

### Phase 3: 測試驗證
- [ ] Sandbox 環境測試（模擬購買 → 檢查發票開立）
- [ ] 驗證 Email 通知送達
- [ ] 確認現有功能無回歸

---

## 參考程式碼範本

```typescript
import { Invoice } from 'node-ecpay-aio';

const invoice = new Invoice({
  MerchantID: '2000132',  // Sandbox MID
  HashKey: 'YOUR_HASH_KEY',
  HashIV: 'YOUR_HASH_IV',
  isStage: true,
});

const result = await invoice.issue({
  RelateNumber: `ORDER_${orderId}`,
  CustomerEmail: user.email,
  SalesAmount: orderTotal,
  InvType: '07',  // B2C 電子發票
  TaxType: '1',   // 應稅
  Items: [
    {
      ItemName: productName,
      ItemCount: 1,
      ItemWord: '式',
      ItemPrice: itemPrice,
      ItemTaxType: '1',
      ItemAmount: itemAmount,
    }
  ],
});
```

---

## 注意事項

- **Sandbox 限制**：測試 MID 共用，不需申請即可測試
- **正式環境申請**：需營業登記、銀行帳戶、統編（使用者確認需求後再處理）
- **錯誤處理**：API 失敗時應記錄 log，不能讓交易失敗（發票可補開）

---

## 下一步

1. Coder 讀取此文件和 `knowledge/einvoice-integration-research.md`
2. 審查金流專案現有程式碼
3. 實作發票整合
4. 完成後通知使用者測試

---

## 路徑存取權限（已設定）

Coder 已配置專案白名單 hook，可存取金流專案路徑。其他 agent 不受影響。

---

**建立時間**：2026-02-19 18:58  
**建立者**：Admin（人資總監）  
**接手者**：Coder
