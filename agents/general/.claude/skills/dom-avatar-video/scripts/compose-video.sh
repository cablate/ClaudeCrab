#!/bin/bash
# ============================================================
# Avatar Video Composer - 標準模板
# ============================================================
# 用法: ./compose-video.sh <project_name>
# 輸入檔案（放在 output/ 目錄）:
#   - <project>_concat.txt   : 圖片序列定義
#   - <project>.mp3          : TTS 音檔（主控時長）
#   - <project>_subtitle.ass : 字幕檔
# 輸出:
#   - <project>_video.mp4
# ============================================================
# 畫面規格: 1080x1350 (4:5，IG Feed 友善)
# 佈局:
#   - 上方 ~200px: 字幕區
#   - 下方 ~1150px: 圖片區（圖片縮小後置中偏下）
# ============================================================

set -e

PROJECT="$1"
if [ -z "$PROJECT" ]; then
    echo "用法: $0 <project_name>"
    echo "範例: $0 template_test"
    exit 1
fi

OUTPUT_DIR="F:/_Program/OwnProject/ClaudeCab/agents/general/output"
CONCAT_FILE="$OUTPUT_DIR/${PROJECT}_concat.txt"
AUDIO_FILE="$OUTPUT_DIR/${PROJECT}.mp3"
SUBTITLE_FILE="$OUTPUT_DIR/${PROJECT}_subtitle.ass"
OUTPUT_FILE="$OUTPUT_DIR/${PROJECT}_video.mp4"
TEMP_DIR="$OUTPUT_DIR/.temp_resize"
TEMP_CONCAT="$TEMP_DIR/concat.txt"

# 標準尺寸
STANDARD_SIZE="896x1200"

# 檢查輸入檔案
for f in "$CONCAT_FILE" "$AUDIO_FILE" "$SUBTITLE_FILE"; do
    if [ ! -f "$f" ]; then
        echo "錯誤: 找不到 $f"
        exit 1
    fi
done

# 取得音檔長度（這是主控時長）
AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO_FILE")
echo "音檔長度: ${AUDIO_DURATION}s"

# ============================================================
# 預處理：統一圖片尺寸
# ============================================================
echo "檢查圖片尺寸..."
mkdir -p "$TEMP_DIR"

# 複製 concat.txt 並處理每張圖片
cp "$CONCAT_FILE" "$TEMP_CONCAT"

# 從 concat.txt 提取圖片路徑並檢查尺寸
grep "^file " "$CONCAT_FILE" | sed "s/^file '//;s/'$//" | while read -r img; do
    if [ -f "$img" ]; then
        size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$img" 2>/dev/null)
        if [ "$size" != "$STANDARD_SIZE" ]; then
            echo "  調整: $(basename "$img") ($size -> $STANDARD_SIZE)"
            temp_img="$TEMP_DIR/$(basename "$img")"
            ffmpeg -y -i "$img" -vf "scale=896:1200:force_original_aspect_ratio=decrease,pad=896:1200:(ow-iw)/2:(oh-ih)/2:white" "$temp_img" 2>/dev/null
            # 替換 concat 中的路徑
            sed -i "s|$img|$temp_img|g" "$TEMP_CONCAT"
        fi
    fi
done

echo "圖片預處理完成"

# ============================================================
# 核心 ffmpeg 指令
# ============================================================
# 畫面: 1080x1350 (4:5)
# 圖片: 縮放到高度 1100，水平置中，垂直偏下（y=250）
# 字幕: 上方區域（ASS 檔案需配合調整 MarginV）
# ============================================================

# 處理 Windows 路徑：ffmpeg ass filter 需要跳脫冒號
SUBTITLE_ESCAPED=$(echo "$SUBTITLE_FILE" | sed 's/:/\\:/g')

ffmpeg -y \
    -f concat -safe 0 -i "$TEMP_CONCAT" \
    -i "$AUDIO_FILE" \
    -filter_complex "[0:v]fps=30,scale=-1:1100,pad=1080:1350:(1080-iw)/2:250:white,format=yuv420p[v];[v]ass='$SUBTITLE_ESCAPED'[vout]" \
    -map "[vout]" \
    -map 1:a \
    -c:v libx264 -preset medium -crf 23 \
    -c:a aac -b:a 128k \
    -t "$AUDIO_DURATION" \
    "$OUTPUT_FILE"

# 清理暫存
rm -rf "$TEMP_DIR"

echo "完成: $OUTPUT_FILE"
