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
TEMP_DIR="$OUTPUT_DIR/.temp_compose"

# 標準規格
STANDARD_SIZE="896x1200"
STANDARD_CODEC="png"

# 檢查輸入檔案
for f in "$CONCAT_FILE" "$AUDIO_FILE" "$SUBTITLE_FILE"; do
    if [ ! -f "$f" ]; then
        echo "❌ 找不到: $f"
        exit 1
    fi
done

# 取得音檔長度（這是主控時長）
AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO_FILE")
echo "🎵 音檔長度: ${AUDIO_DURATION}s"

# ============================================================
# Phase 1: 預處理 — 統一圖片編碼 + 尺寸
# ============================================================
echo ""
echo "🔍 Phase 1: 圖片預處理..."
mkdir -p "$TEMP_DIR"

# 複製 concat.txt 到暫存目錄
cp "$CONCAT_FILE" "$TEMP_DIR/concat.txt"

NEEDS_FIX=0

# 從 concat.txt 提取圖片路徑並逐一檢查
grep "^file " "$CONCAT_FILE" | sed "s/^file '//;s/'$//" | sort -u | while read -r img; do
    if [ ! -f "$img" ]; then
        echo "  ❌ 找不到: $img"
        continue
    fi

    # 檢查編碼
    codec=$(ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$img" 2>/dev/null)
    # 檢查尺寸
    size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$img" 2>/dev/null)

    need_convert=0

    if [ "$codec" != "$STANDARD_CODEC" ]; then
        echo "  🔄 編碼修正: $(basename "$img") ($codec → $STANDARD_CODEC)"
        need_convert=1
    fi

    if [ "$size" != "$STANDARD_SIZE" ]; then
        echo "  📐 尺寸修正: $(basename "$img") ($size → $STANDARD_SIZE)"
        need_convert=1
    fi

    if [ "$need_convert" -eq 1 ]; then
        # 建立暫存目錄結構
        rel_dir=$(dirname "$img" | sed "s|$OUTPUT_DIR/||")
        mkdir -p "$TEMP_DIR/$rel_dir"
        temp_img="$TEMP_DIR/$rel_dir/$(basename "$img")"

        # 統一轉換：真 PNG + 標準尺寸
        ffmpeg -y -i "$img" \
            -vf "scale=896:1200:force_original_aspect_ratio=decrease,pad=896:1200:(ow-iw)/2:(oh-ih)/2:white" \
            "$temp_img" 2>/dev/null

        # 替換 concat 中的路徑
        # 使用 | 作為 sed 分隔符避免路徑中的 / 衝突
        escaped_img=$(echo "$img" | sed 's/[&/\]/\\&/g')
        escaped_temp=$(echo "$temp_img" | sed 's/[&/\]/\\&/g')
        sed -i "s|$img|$temp_img|g" "$TEMP_DIR/concat.txt"
    fi
done

echo "  ✅ 預處理完成"

# ============================================================
# Phase 2: 合成影片
# ============================================================
echo ""
echo "🎬 Phase 2: ffmpeg 合成..."

# subtitles filter 也需要跳脫 Windows 冒號（F: → F\:）
SUBTITLE_ESCAPED=$(echo "$SUBTITLE_FILE" | sed 's/:/\\:/g')
ffmpeg -y \
    -f concat -safe 0 -i "$TEMP_DIR/concat.txt" \
    -i "$AUDIO_FILE" \
    -filter_complex "
        [0:v]fps=30,
        scale=-1:1100,
        pad=1080:1350:(1080-iw)/2:250:white,
        format=yuv420p[v];
        [v]subtitles='$SUBTITLE_ESCAPED'[vout]
    " \
    -map "[vout]" \
    -map 1:a \
    -c:v libx264 -preset medium -crf 23 \
    -c:a aac -b:a 128k \
    -t "$AUDIO_DURATION" \
    "$OUTPUT_FILE"

# 清理暫存
rm -rf "$TEMP_DIR"

echo ""
echo "✅ 完成: $OUTPUT_FILE"
echo "   時長: ${AUDIO_DURATION}s"
