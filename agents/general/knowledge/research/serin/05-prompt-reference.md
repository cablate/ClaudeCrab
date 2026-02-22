# Cab 形象圖包 — 提示詞參考指南

**基於 Serin 塞琳研究，整理出 Cab 可用的圖包生成提示詞方向。**

---

## Cab 的定位設定（待填入）

> 以下框架需要 Cab 確認自己的具體形象設定後填入。

| 設定項目 | Serin 的設定 | Cab 的設定（待定） |
|---------|------------|-----------------|
| 髮色 | 白髮 | ？ |
| 耳型 | 狐耳 | ？ |
| 主服裝 | Hoodie + 領帶 | ？ |
| 配件 | 腿環、墨鏡（恰飯時） | ？ |
| 尾巴 | 無 | ？ |
| 整體風格 | 二次元 ACG，日常感 | ？ |

---

## 提示詞框架結構

生成表情包/立繪時，提示詞建議分四層：

```
[角色基礎描述] + [當前表情/動作] + [風格關鍵字] + [技術規格]
```

---

## 通用角色描述模板（待填入 Cab 的設定）

```
[角色設定]：
- 白髮（或其他髮色）短髮/中長髮
- 狐耳（或其他獸耳/特徵）
- 穿著帽衫（或主服裝），搭配領帶（或主配件）
- 二次元風格，線條清晰，日系動漫畫風
- 半身立繪 / 全身立繪 / 表情特寫
- 透明背景

[基礎 prompt 關鍵字]：
anime style, clean lineart, flat color shading,
white hair, fox ears, hoodie, tie,
half body portrait, transparent background,
2D character illustration
```

---

## 表情包分類提示詞

### 基礎情緒系列

**開心/笑**
```
smiling, happy expression, curved eyes (>‿<),
slight blush, teeth showing or closed mouth smile
```

**嚴肅/認真**
```
serious expression, slightly furrowed brows,
direct eye contact, neutral mouth, focused look
```

**困惑/歪頭**
```
confused expression, head tilted to one side,
question mark above head, raised eyebrow,
slightly open mouth
```

**崩潰/無語**
```
deadpan expression, half-closed eyes,
empty stare, flat mouth, internally screaming
```

**傲嬌**
```
tsundere expression, looking away, slight blush,
arms crossed, pouting, reluctant smile
```

**嫌棄**
```
disdainful expression, one eyebrow raised,
mouth slightly pursed, eyes slightly narrowed
```

**害羞/臉紅**
```
embarrassed, heavy blush on cheeks,
hands raised to face, avoiding eye contact,
shy smile or flustered open mouth
```

**偷笑**
```
mischievous smirk, hand covering mouth,
eyes slightly squinting with amusement
```

---

### 動作反應系列

**思考**
```
thinking pose, finger on chin or cheek,
eyes looking upward, slight head tilt
```

**趴下/疲憊**
```
exhausted, slumped pose, lying face down,
sweat drop, eyes half closed
```

**睡著**
```
sleeping, eyes closed, ZZZ bubble,
peaceful expression, slight smile
```

**舉手**
```
raising one hand, eager expression,
slight forward lean
```

---

### 反差感專用系列（Cab 特色）

**「我才沒有撒嬌」（傲嬌否認）**
```
tsundere denial, looking away with crossed arms,
visible blush, trying to look indifferent but failing,
hint of embarrassment
```

**被說穿時的反應**
```
caught off guard expression, wide eyes, slight panic,
sweat drops, nervous laugh (forced smile)
```

**「就是這樣沒錯」（自得）**
```
smug expression, confident smile,
arms crossed, chin slightly raised,
satisfied look
```

**恰飯模式（墨鏡版，參考 Serin）**
```
wearing sunglasses, money sign expression,
slightly dramatic pose, optional money effects
```

---

## 技術規格關鍵字

```
transparent background (PNG),
2D flat illustration,
clean lineart, no gradient background,
anime coloring style,
consistent art style across expressions,
500x500 or 1000x1000 resolution
```

---

## 風格關鍵字選擇

依目標風格選擇其中一個方向：

| 風格 | 關鍵字 |
|------|--------|
| 日系動漫（Serin 同款） | anime style, bishoujo/bishounen, soft shading |
| 可愛 Q 版 | chibi style, big eyes, small body |
| 俏皮插畫 | kawaii, sticker style, bold outline |
| 寫實動漫 | semi-realistic anime, detailed shading |

---

## 使用 dom-image-gen 時的注意事項

1. 先確定自己的形象設定（髮色、耳型、服裝），建立固定的「角色描述模板」
2. 每個表情用同一套角色描述，只改「表情/動作」部分
3. 如果需要保持多圖一致性，用 `maintainCharacterConsistency: true`
4. 第一批建議先生成 7-10 個核心表情，確認風格後再批量生成
