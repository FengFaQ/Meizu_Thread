#!/system/bin/sh
set -e

MODDIR="${0%/*}"
CONFIG_FILE="$MODDIR/confige.txt"
APPLIST_CONF="$MODDIR/applist.conf"

RAW_BASE="https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main"
API_URL="https://api.github.com/repos/FengFaQ/Meizu_Thread/commits"
PER_PAGE=22

TMP_BASE="$MODDIR/.tmp_base.$$"
TMP_MEIZU="$MODDIR/.tmp_meizu.$$"
TMP_ASOUL="$MODDIR/.tmp_asoul.$$"
TMP_RULES="$MODDIR/.tmp_rules.$$"
API_RESPONSE="$MODDIR/.api_response.$$"

cleanup() {
    rm -f "$TMP_BASE" "$TMP_MEIZU" "$TMP_ASOUL" "$TMP_RULES" "$API_RESPONSE"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# ---------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------
download_file() {
    local url="$1"
    local output="$2"

    rm -f "$output"
    if command -v curl >/dev/null 2>&1; then
        if ! curl -fsSL --connect-timeout 10 -o "$output" "$url"; then
            rm -f "$output"
            return 1
        fi
    elif command -v wget >/dev/null 2>&1; then
        if ! wget -q -T 10 -O "$output" "$url"; then
            rm -f "$output"
            return 1
        fi
    else
        return 1
    fi

    if [ ! -s "$output" ]; then
        rm -f "$output"
        return 1
    fi
}

get_config_value() {
    [ -f "$CONFIG_FILE" ] || return 0
    grep -E "^$1=" "$CONFIG_FILE" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r\n'
}

set_config_value() {
    local key="$1"
    local value="$2"

    if grep -q "^${key}=" "$CONFIG_FILE" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$CONFIG_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$CONFIG_FILE"
    fi
}

# ---------------------------------------------------------------
# 读取配置
#   meizu = on/off   魅族专属规则
#   asoul = on/off   AsoulOpt 游戏规则（独立栏目）
#   8G3   = on/off   彗星底座使用 8G3 还是 common 规则
# ---------------------------------------------------------------
MEIZU_VAL="$(get_config_value meizu)"
ASOUL_VAL="$(get_config_value asoul)"
SOC_8G3="$(get_config_value 8G3)"
TIME_AREA="$(get_config_value time_area)"
LAST_TIME="$(get_config_value time)"

[ "$MEIZU_VAL" = "off" ] || MEIZU_VAL="on"
[ "$ASOUL_VAL" = "off" ] || ASOUL_VAL="on"
[ "$SOC_8G3" = "on" ] || SOC_8G3="off"
[ -n "$TIME_AREA" ] || TIME_AREA="UTC"

# 彗星底座档位
if [ "$SOC_8G3" = "on" ]; then
    BASE_NAME="8G3"
    APP_URL="$RAW_BASE/base/App_8G3.txt"
else
    BASE_NAME="Common"
    APP_URL="$RAW_BASE/base/App_common.txt"
fi

echo "-------------------------------------"
echo "📱 魅族线程配置"
echo "   彗星底座: $BASE_NAME"
echo "   魅族专属: $MEIZU_VAL"
echo "   AsoulOpt : $ASOUL_VAL"
echo "-------------------------------------"

: > "$TMP_RULES"

# ---------------------------------------------------------------
# 1. 彗星底座（日用应用）
# ---------------------------------------------------------------
echo "⬇️  正在下载彗星底座 ($BASE_NAME)..."
if ! download_file "$APP_URL" "$TMP_BASE"; then
    echo "❌ 底座下载失败，请检查网络"
    echo "⚠️  已保留当前配置"
    exit 1
fi
printf '# ===== 彗星底座 (%s) =====\n' "$BASE_NAME" >> "$TMP_RULES"
cat "$TMP_BASE" >> "$TMP_RULES"
printf '\n' >> "$TMP_RULES"

# ---------------------------------------------------------------
# 2. 魅族专属规则
# ---------------------------------------------------------------
if [ "$MEIZU_VAL" = "on" ]; then
    echo "⬇️  正在下载魅族专属规则..."
    if download_file "$RAW_BASE/meizu_rules.conf" "$TMP_MEIZU"; then
        printf '\n# ===== 魅族专属规则 =====\n' >> "$TMP_RULES"
        cat "$TMP_MEIZU" >> "$TMP_RULES"
        printf '\n' >> "$TMP_RULES"
    else
        echo "⚠️  魅族规则下载失败，已跳过（其余配置仍会应用）"
    fi
fi

# ---------------------------------------------------------------
# 3. AsoulOpt 游戏规则（独立部分）
# ---------------------------------------------------------------
if [ "$ASOUL_VAL" = "on" ]; then
    echo "⬇️  正在下载 AsoulOpt 游戏规则..."
    if download_file "$RAW_BASE/asoulopt_rules.conf" "$TMP_ASOUL"; then
        printf '\n# ===== AsoulOpt 游戏规则 =====\n' >> "$TMP_RULES"
        cat "$TMP_ASOUL" >> "$TMP_RULES"
        printf '\n' >> "$TMP_RULES"
    else
        echo "⚠️  AsoulOpt 规则下载失败，已跳过（其余配置仍会应用）"
    fi
fi

mv -f "$TMP_RULES" "$APPLIST_CONF"

# ---------------------------------------------------------------
# 更新描述与时间
# ---------------------------------------------------------------
if ! UPDATE_TIME=$(TZ="$TIME_AREA" date +"%m%d %H:%M" 2>/dev/null); then
    TIME_AREA=UTC
    UPDATE_TIME=$(TZ=UTC date +"%m%d %H:%M")
    set_config_value time_area "$TIME_AREA"
fi

ASOUL_NAME="Off"
[ "$ASOUL_VAL" = "on" ] && ASOUL_NAME="On"
MEIZU_NAME="Off"
[ "$MEIZU_VAL" = "on" ] && MEIZU_NAME="On"

sed -i "/^description=/ s|^description=.*|description=魅族线程 $BASE_NAME 魅族:${MEIZU_NAME} Asoul:${ASOUL_NAME} 配置时间:${UPDATE_TIME}|" "$MODDIR/module.prop"

UTC_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
set_config_value time "$UTC_TIME"

echo "-------------------------------------"
echo "✅ 配置已更新"
echo "-------------------------------------"
echo "📝 更新内容:"

if [ -n "$LAST_TIME" ]; then
    FETCH_URL="${API_URL}?sha=main&since=${LAST_TIME}&per_page=${PER_PAGE}"
else
    FETCH_URL="${API_URL}?sha=main&per_page=${PER_PAGE}"
fi

HTTP_CODE=""
if command -v curl >/dev/null 2>&1; then
    set +e
    HTTP_CODE=$(curl -sSL --connect-timeout 10 -A "Meizu-Thread" \
        -H "Accept: application/vnd.github+json" \
        -o "$API_RESPONSE" -w "%{http_code}" "$FETCH_URL" 2>/dev/null)
    set -e
fi

if [ "$HTTP_CODE" = "200" ]; then
    set +e
    NEW_COMMITS=$(grep -Eo '"message"[[:space:]]*:[[:space:]]*"[^"]*"' "$API_RESPONSE" | \
        sed 's/^"message"[[:space:]]*:[[:space:]]*"//;s/"$//' | \
        sed 's/\\n.*//' | grep -E "^(Base|Meizu|Asoul):")
    set -e
    if [ -n "$NEW_COMMITS" ]; then
        echo "$NEW_COMMITS"
    else
        echo "暂无新更新"
    fi
elif [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "429" ]; then
    echo "⚠️  GitHub API 请求过于频繁，请稍后再试"
elif [ -z "$HTTP_CODE" ]; then
    echo "⚠️  当前环境缺少 curl，已跳过更新日志查询"
else
    echo "⚠️  GitHub API 返回错误 ($HTTP_CODE)"
fi

echo "-------------------------------------"
echo "🎉 配置更新完成，无需重启"
