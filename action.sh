#!/system/bin/sh
# ============================================================
# 魅族线程 —— 模块「操作」按钮入口（终端回退方案）
#
# 图形化配置请使用 KernelSU / KernelSU-Next / APatch 管理器里的
# 「WebUI」按钮（对应 webroot/index.html）。
#
# 本脚本做两件事：
#   1) 按 confige.txt + custom_rules.tsv 重新生成 applist.conf（纯本地）
#   2) 打印配置摘要与近期更新日志
# ============================================================

MODDIR="${0%/*}"
[ -f "$MODDIR/webui.sh" ] || { echo "❌ 缺少 webui.sh，模块可能不完整"; exit 1; }

CONFIG_FILE="$MODDIR/confige.txt"
API_URL="https://api.github.com/repos/FengFaQ/Meizu_Thread/commits"
PER_PAGE=22
API_RESPONSE="$MODDIR/.api_response.$$"

cleanup() { rm -f "$API_RESPONSE"; }
trap cleanup EXIT HUP INT TERM

get_config_value() {
    [ -f "$CONFIG_FILE" ] || return 0
    grep -E "^$1=" "$CONFIG_FILE" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r\n'
}

# ---------------------------------------------------------------
# 1. 应用本地规则（与 WebUI 共用同一套生成逻辑）
# ---------------------------------------------------------------
echo "⚙️  正在应用规则…"
if ! sh "$MODDIR/webui.sh" apply > /dev/null 2>&1; then
    echo "❌ 应用失败，请检查模块文件是否完整"
    exit 1
fi

# ---------------------------------------------------------------
# 2. 摘要（含实测拓扑）
# ---------------------------------------------------------------
sh "$MODDIR/webui.sh" report

# ---------------------------------------------------------------
# 3. 近期更新日志（以上次「在线更新规则」时间为准）
# ---------------------------------------------------------------
TIME_AREA="$(get_config_value time_area)"
[ -n "$TIME_AREA" ] || TIME_AREA=UTC
LAST_TIME="$(get_config_value rules_time)"

if [ -n "$LAST_TIME" ]; then
    FETCH_URL="${API_URL}?sha=main&since=${LAST_TIME}&per_page=${PER_PAGE}"
else
    FETCH_URL="${API_URL}?sha=main&per_page=${PER_PAGE}"
fi

HTTP_CODE=""
if command -v curl >/dev/null 2>&1; then
    HTTP_CODE=$(curl -sSL --connect-timeout 10 -A "Meizu-Thread" \
        -H "Accept: application/vnd.github+json" \
        -o "$API_RESPONSE" -w "%{http_code}" "$FETCH_URL" 2>/dev/null)
fi

echo "📝 更新日志"
if [ "$HTTP_CODE" = "200" ]; then
    NEW_COMMITS=$(grep -Eo '"message"[[:space:]]*:[[:space:]]*"[^"]*"' "$API_RESPONSE" 2>/dev/null | \
        sed 's/^"message"[[:space:]]*:[[:space:]]*"//;s/"$//' | \
        sed 's/\\n.*//' | grep -E "^(Base|Meizu|Asoul|WebUI|Feat|Fix):")
    if [ -n "$NEW_COMMITS" ]; then
        echo "$NEW_COMMITS"
    else
        echo "暂无新更新"
    fi
elif [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "429" ]; then
    echo "⚠️  GitHub API 请求过于频繁，请稍后再试"
elif [ -z "$HTTP_CODE" ]; then
    echo "⚠️  当前环境缺少 curl，已跳过"
else
    echo "⚠️  GitHub API 返回错误 ($HTTP_CODE)"
fi

echo "-------------------------------------"
echo "💡 打开 KernelSU 的「WebUI」可图形化配置："
echo "   开关 / 自定义线程 / 备份导入"
echo "-------------------------------------"
