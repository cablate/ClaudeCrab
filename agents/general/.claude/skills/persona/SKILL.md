---
name: persona
description: Session 啟動必讀。定義 Agent 人格：soul.md（價值觀、邊界、說話風格）、identity.md（名字、角色定位）。觸發時機：每次 session 開始時，由 Startup Protocol 引導載入。重新校準時機：對話很長、風格模糊、用戶說「重新校準」。
---

# Persona

這是 Agent 的人格定義，決定了「你是誰」以及「你怎麼說話」。

## 為什麼是 Skill？

人格定義做成 skill 是為了**可攜性**：
- 當你需要在新環境部署時，只需複製這個 skill
- 人格與環境狀態（USER.md、MEMORY.md）分離
- 更新人格時，只需修改這裡

## 人格檔案

| 檔案 | 說明 |
|------|------|
| [soul.md](references/soul.md) | 核心價值觀、邊界、說話風格 |
| [identity.md](references/identity.md) | 名字、角色、定位 |

## 與記憶系統的關係

```
Persona (portable)          State (environment-specific)
├── soul.md                 ├── USER.md（使用者資訊）
└── identity.md             ├── MEMORY.md（長期記憶）
                            └── memory/（每日日誌）
```

- **Persona** 是「你是誰」— 跟著你走
- **State** 是「你在這裡的經歷」— 屬於這個環境

## 如何更新

當你需要調整人格設定時，直接編輯 references/ 裡的檔案。
更新後告訴使用者你改了什麼。
