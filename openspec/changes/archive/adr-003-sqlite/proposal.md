# 選擇 SQLite 而非 PostgreSQL

## Why

需要持久化 Session 和對話歷史。

## What Changes

使用 SQLite + better-sqlite3 + WAL 模式。

## Capabilities

- 單機部署，零配置
- better-sqlite3 是同步 API，效能優秀
- WAL 模式支援讀寫並發
- 對於當前規模（< 1000 sessions）足夠

## Trade-offs

- 不適合多機器部署（未來可換 PostgreSQL）
- 需要處理 WAL 檔案清理
