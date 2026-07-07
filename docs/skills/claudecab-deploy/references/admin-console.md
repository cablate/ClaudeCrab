# ClaudeCab Admin Console

Admin console 是最小 operator 後台，不是公開 dashboard，也不是 Discord 使用者功能。

## 啟用

```env
ADMIN_CONSOLE_ENABLED=true
ADMIN_CONSOLE_HOST=127.0.0.1
ADMIN_CONSOLE_PORT=47824
ADMIN_CONSOLE_TOKEN=replace-with-long-random-token
CLAUDECAB_LOCAL_CONFIG_PATH=./data/claudecab.local.json
```

Open:

```text
http://127.0.0.1:47824
```

## 可做的事

- 讀取遮罩後的全域設定。
- 寫入 allowlist 內的全域覆寫到 `data/claudecab.local.json`。
- 讀寫 allowlist 內的 `agent.json` 欄位。
- 讀寫 allowlist 內的 `.claude/settings.local.json` model/provider env。
- 執行 setup check / setup verify。
- build check 通過後 request restart。

## 安全規則

- API 需要 `Authorization: Bearer <ADMIN_CONSOLE_TOKEN>`。
- secret 欄位不回傳明文。
- unknown fields 會被拒絕。
- agent path traversal 會被拒絕。
- 預設只綁 localhost。

## Docker / Cloud 注意事項

Container 與 cloud env 通常不能從 running process 內永久改寫。需要 runtime 可調整的全域值時，admin console 會寫入 `CLAUDECAB_LOCAL_CONFIG_PATH`。

請掛載 `./data:/app/data` 或等效 volume，讓 `claudecab.local.json` 重啟後仍存在。

如果平台每次啟動都注入同名 env，ClaudeCab 內部會以 local overlay 為準，因為 `src/config.ts` 會在 env 之後合併 local overlay。
