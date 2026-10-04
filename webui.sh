#!/system/bin/sh
# ============================================================
# 魅族线程 (Meizu Thread) — WebUI 后端
#
# 由 KernelSU / KernelSU-Next 的 WebUI(webroot) 以 root 身份调用：
#     sh /data/adb/modules/Meizu_Thread/webui.sh <子命令> [参数...]
#
# 子命令一览：
#   status                     状态总览（JSON，含开关/规则统计/实测拓扑）
#   apply                      按 confige.txt + custom_rules.tsv 重新生成 applist.conf
#   set-flags <meizu> <asoul> <8G3>   写入开关（on/off）
#   update-rules               从 GitHub 在线更新三套规则源文件
#   apps                       应用清单（TSV：包名/内置规则数/自定义数/是否已适配）
#   app <包名>                 某应用的线程规则明细（TSV：线程/核心/是否自定义）
#   set-rule <包名> <线程> <核心>      新增或覆盖一条自定义规则（线程留 - 表示进程兜底）
#   del-rule <包名> <线程>             删除一条自定义规则
#   reset-app <包名>           清空某应用全部自定义规则（回到内置行为）
#   reset-all                  清空全部自定义规则
#   export                     备份配置，写到 /sdcard/Download 并回传内容
#   import <文件路径>           从备份文件导入配置
#
# 设计要点：
#   1) 自定义规则【排在最前】，并【剔除】内置中同选择器的行，
#      因此每个选择器在全文件中唯一 —— 覆盖语义明确，不依赖引擎去重方向。
#   2) 本地优先：规则源文件随包内置，无网也能 apply；联网仅用于 update-rules。
#   3) 纯 POSIX sh + toybox/busybox 工具，不依赖 jq / python。
# ============================================================

# ---------------------------------------------------------------
# 定位模块目录
# ---------------------------------------------------------------
SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/module.prop" ]; then
    MODDIR="$SELF_DIR"
elif [ -d /data/adb/modules/Meizu_Thread ]; then
    MODDIR=/data/adb/modules/Meizu_Thread
else
    MODDIR="$SELF_DIR"
fi

CONFIG="$MODDIR/confige.txt"
APPLIST="$MODDIR/applist.conf"
CUSTOM="$MODDIR/custom_rules.tsv"
BASE_8G3="$MODDIR/base/App_8G3.txt"
BASE_COMMON="$MODDIR/base/App_common.txt"
SRC_MEIZU="$MODDIR/meizu_rules.conf"
SRC_ASOUL="$MODDIR/asoulopt_rules.conf"
MODPROP="$MODDIR/module.prop"

RAW_BASE="https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main"
BACKUP_DIR="/sdcard/Download"

TMP="${TMPDIR:-/tmp}/meizu_webui.$$"
mkdir -p "$TMP" 2>/dev/null

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

CORE_RE='^(e-core|p-core|hp-core|all-core)(,(e-core|p-core|hp-core|all-core))*$'

# ---------------------------------------------------------------
# 通用工具
# ---------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

# 读取 confige.txt 的键值
cfg_get() {
    [ -f "$CONFIG" ] || return 0
    grep -E "^$1=" "$CONFIG" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r\n'
}

# 写入 confige.txt 的键值
cfg_set() {
    local key="$1" value="$2"
    [ -f "$CONFIG" ] || : > "$CONFIG"
    if grep -q "^${key}=" "$CONFIG" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$CONFIG"
    else
        printf '%s=%s\n' "$key" "$value" >> "$CONFIG"
    fi
}

# 把 stdin 转成 JSON 字符串内容（不含首尾引号）
json_str() {
    awk 'BEGIN{ORS=""}
        {
            gsub(/\\/, "\\\\")
            gsub(/"/, "\\\"")
            gsub(/\t/, "\\t")
            gsub(/\r/, "")
            if (NR > 1) printf "\\n"
            printf "%s", $0
        }'
}

# 输出 JSON 结果对象：result <ok 0/1> <message>
result() {
    local ok="$1"; shift
    printf '{"ok":%s,"msg":"%s"}\n' \
        "$([ "$ok" = "1" ] && echo true || echo false)" \
        "$(printf '%s' "$*" | json_str)"
    exit 0
}

# 选取当前底座文件
base_file() {
    if [ "$(cfg_get 8G3)" = "on" ]; then
        printf '%s' "$BASE_8G3"
    else
        printf '%s' "$BASE_COMMON"
    fi
}

base_name() {
    if [ "$(cfg_get 8G3)" = "on" ]; then printf '8G3'; else printf 'Common'; fi
}

# ---------------------------------------------------------------
# 拓扑探测：把 e-core / p-core / hp-core 展开成实际 CPU 号
#   依据 cpufreq/policy*/cpuinfo_max_freq 分组，频率相同者同簇
# ---------------------------------------------------------------
topology() {
    local groups freq cpus
    groups=""

    for d in /sys/devices/system/cpu/cpufreq/policy*; do
        [ -d "$d" ] || continue
        freq="$(cat "$d/cpuinfo_max_freq" 2>/dev/null)" || continue
        cpus="$(cat "$d/related_cpus" 2>/dev/null)" || continue
        [ -n "$freq" ] && [ -n "$cpus" ] || continue
        groups="$groups$freq $cpus
"
    done

    groups="$(printf '%s' "$groups" | grep -v '^$' | sort -n)"
    [ -n "$groups" ] || return 1

    local n e p hp all i=0 line gf gc
    n="$(printf '%s\n' "$groups" | wc -l | tr -d ' ')"
    e=""; p=""; hp=""
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        gf="${line%% *}"
        gc="${line#* }"
        i=$((i + 1))
        if [ "$i" -eq 1 ]; then
            e="$gc"
        elif [ "$i" -eq "$n" ]; then
            hp="$gc"
        else
            if [ -z "$p" ]; then p="$gc"; else p="$p,$gc"; fi
        fi
        if [ -z "$all" ]; then all="$gc"; else all="$all,$gc"; fi
    done <<EOF
$groups
EOF

    # 单簇设备：全部归 e-core，hp/p 留空
    [ -n "$p" ] || p="$e"

    printf 'e-core=%s|p-core=%s|hp-core=%s|all-core=%s' "$e" "$p" "$hp" "$all"
}

# 合并形如 0-1,2-3 的 CPU 列表为紧凑区间
compact_cpus() {
    local raw
    raw="$(printf '%s' "$1" | tr ',' '\n' | grep -E '^[0-9]+$' | sort -n)"
    [ -n "$raw" ] || { printf '%s' "$1"; return; }
    printf '%s\n' "$raw" | awk '
        NR==1 { start=$1; prev=$1; next }
        { if ($1 == prev+1) { prev=$1; next }
          if (start==prev) printf "%d,", start; else printf "%d-%d,", start, prev
          start=$1; prev=$1 }
        END { if (NR>0) { if (start==prev) printf "%d", start; else printf "%d-%d", start, prev } }'
}

# ---------------------------------------------------------------
# 规则统计：统计某文件中的有效规则条数
# ---------------------------------------------------------------
count_rules() {
    [ -f "$1" ] || { echo 0; return; }
    grep -cE '^[^#[:space:]][^=]*=' "$1" 2>/dev/null | tr -d ' '
}

# 统计行数（自定义规则条数；grep -c 在 0 匹配时退出码非 0，故不用它）
count_lines() {
    [ -f "$1" ] || { echo 0; return; }
    wc -l < "$1" 2>/dev/null | tr -d ' '
}

# 从 custom_rules.tsv 生成规则体与选择器列表
gen_custom() {
    : > "$TMP/body"
    : > "$TMP/keys"
    [ -s "$CUSTOM" ] || return 0
    awk -F'\t' '
        /^[[:space:]]*#/ { next }
        {
            pkg=$1; thr=$2; core=$3
            gsub(/^[ \t]+|[ \t]+$/, "", pkg)
            gsub(/^[ \t]+|[ \t]+$/, "", thr)
            gsub(/^[ \t]+|[ \t]+$/, "", core)
            if (pkg == "" || core == "") next
            sel = (thr == "" ) ? pkg : pkg "{" thr "}"
            print sel "=" core
            print sel > keyfile
        }
    ' keyfile="$TMP/keys" "$CUSTOM" > "$TMP/body"
}

# 提取某规则文件覆盖的全部包名（去重）
build_pkg_set() {
    local src="$1" out="$2"
    : > "$out"
    [ -f "$src" ] || return 0
    have awk || return 0
    awk '
        /^[[:space:]]*#/ { next }
        /=/ {
            sel = $0
            sub(/=.*$/, "", sel)
            gsub(/[ \t]/, "", sel)
            pkg = sel
            sub(/[{:].*$/, "", pkg)
            if (pkg != "") print pkg
        }
    ' "$src" | sort -u > "$out"
}

# 过滤内置源文件：
#   1) 丢掉与自定义规则同【选择器】的行     —— 自定义优先
#   2) 丢掉包名落在 pkgfile 集合内的行       —— 魅族段整体覆盖底座
filter_source() {
    local file="$1" pkgfile="$2"
    [ -f "$file" ] || return 0
    if ! have awk; then cat "$file"; return; fi
    awk -v keyfile="$TMP/keys" -v pkgfile="$pkgfile" '
        BEGIN {
            while ((getline k < keyfile) > 0) {
                gsub(/^[ \t]+|[ \t]+$/, "", k)
                if (k != "") keys[k] = 1
            }
            if (pkgfile != "") {
                while ((getline x < pkgfile) > 0) {
                    gsub(/^[ \t]+|[ \t]+$/, "", x)
                    if (x != "") pkgs[x] = 1
                }
            }
        }
        /^[[:space:]]*#/ { print; next }
        /^[[:space:]]*$/ { print; next }
        {
            sel = $0
            sub(/=.*$/, "", sel)
            gsub(/^[ \t]+|[ \t]+$/, "", sel)
            if (sel in keys) next
            pkg = sel
            sub(/[{:].*$/, "", pkg)
            if (pkg in pkgs) next
            print
        }
    ' "$file"
}

# ---------------------------------------------------------------
# 生成 applist.conf
# ---------------------------------------------------------------
do_apply() {
    local meizu asoul base total nbase nmeizu nasoul ncustom
    meizu="$(cfg_get meizu)"; [ "$meizu" = "off" ] || meizu=on
    asoul="$(cfg_get asoul)"; [ "$asoul" = "off" ] || asoul=on

    base="$(base_file)"
    if [ ! -f "$base" ]; then
        printf '{"ok":false,"msg":"底座规则文件缺失：%s"}\n' "$(basename "$base")"
        return 1
    fi

    gen_custom
    ncustom="$(count_lines "$TMP/body")"

    # 魅族段覆盖的包名集合（仅当魅族段启用时才排除底座中的同名包）
    if [ "$meizu" = on ] && [ -f "$SRC_MEIZU" ]; then
        build_pkg_set "$SRC_MEIZU" "$TMP/meizu.pkgs"
    else
        : > "$TMP/meizu.pkgs"
    fi

    local out="$TMP/applist.conf"
    {
        printf '# ============================================================\n'
        printf '# 魅族 21 (骁龙 8 Gen 3) 专属线程配置\n'
        printf '# ============================================================\n'
        printf '# 本文件由 Meizu_Thread WebUI 自动生成，请勿手工编辑。\n'
        printf '# 底座：Comet Thread Opt (彗星线程) %s\n' "$(base_name)"
        printf '# 魅族段：%s\n' "$([ "$meizu" = on ] && echo 启用 || echo 关闭)"
        printf '# 游戏段：AsoulOpt %s\n' "$([ "$asoul" = on ] && echo 启用 || echo 关闭)"
        printf '# 自定义：%s 条（优先级最高，会覆盖同选择器的内置规则）\n' "$ncustom"
        printf '#\n'
        printf '# 符号核心名由引擎按设备实测拓扑在运行时展开。\n'
        printf '# ============================================================\n'
        printf '\n'

        if [ -s "$TMP/body" ]; then
            printf '# ===== 自定义线程规则（最高优先级）=====\n'
            cat "$TMP/body"
            printf '\n'
        fi

        printf '# ===== 彗星底座 (%s) =====\n' "$(base_name)"
        filter_source "$base" "$TMP/meizu.pkgs"
        printf '\n'

        if [ "$meizu" = on ] && [ -f "$SRC_MEIZU" ]; then
            printf '# ===== 魅族专属规则 =====\n'
            filter_source "$SRC_MEIZU" ""
            printf '\n'
        fi

        if [ "$asoul" = on ] && [ -f "$SRC_ASOUL" ]; then
            printf '# ===== AsoulOpt 游戏规则 =====\n'
            filter_source "$SRC_ASOUL" ""
            printf '\n'
        fi
    } > "$out"

    total="$(count_rules "$out")"
    nbase="$(count_rules "$base")"
    nmeizu=0; [ "$meizu" = on ] && nmeizu="$(count_rules "$SRC_MEIZU")"
    nasoul=0; [ "$asoul" = on ] && nasoul="$(count_rules "$SRC_ASOUL")"

    cp "$out" "$APPLIST"
    rm -f "$out"

    # 更新时间戳与模块描述
    local tz utc ts
    tz="$(cfg_get time_area)"; [ -n "$tz" ] || tz=UTC
    utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    ts="$(TZ="$tz" date +"%m%d %H:%M" 2>/dev/null)" || ts="$(date -u +"%m%d %H:%M")"
    cfg_set time "$utc"

    if [ -f "$MODPROP" ]; then
        local mz_name as_name
        mz_name=Off; [ "$meizu" = on ] && mz_name=On
        as_name=Off; [ "$asoul" = on ] && as_name=On
        sed -i "/^description=/ s|^description=.*|description=魅族线程 $(base_name) 魅族:${mz_name} Asoul:${as_name} 配置时间:${ts}|" "$MODPROP"
    fi

    printf '{"ok":true,"total":%s,"base":%s,"meizu":%s,"asoul":%s,"custom":%s,"msg":"已应用：共 %s 条规则"}\n' \
        "$total" "$nbase" "$nmeizu" "$nasoul" "$ncustom" "$total"
}

# ---------------------------------------------------------------
# status
# ---------------------------------------------------------------
do_status() {
    local meizu asoul g83 total nbase nmeizu nasoul ncustom top
    meizu="$(cfg_get meizu)"; [ "$meizu" = "off" ] || meizu=on
    asoul="$(cfg_get asoul)"; [ "$asoul" = "off" ] || asoul=on
    g83="$(cfg_get 8G3)";    [ "$g83" = "on" ] || g83=off

    total="$(count_rules "$APPLIST")"
    nbase="$(count_rules "$(base_file)")"
    nmeizu=0; [ "$meizu" = on ] && nmeizu="$(count_rules "$SRC_MEIZU")"
    nasoul=0; [ "$asoul" = on ] && nasoul="$(count_rules "$SRC_ASOUL")"
    ncustom=0
    [ -s "$CUSTOM" ] && ncustom="$(awk -F'\t' '!/^[[:space:]]*#/ && NF>=3 && $1!="" {n++} END{print n+0}' "$CUSTOM")"

    top="$(topology 2>/dev/null)" || top="e-core=|p-core=|hp-core=|all-core="

    local ec pc hc ac
    ec="$(printf '%s' "$top" | tr '|' '\n' | grep '^e-core=' | cut -d= -f2)"
    pc="$(printf '%s' "$top" | tr '|' '\n' | grep '^p-core=' | cut -d= -f2)"
    hc="$(printf '%s' "$top" | tr '|' '\n' | grep '^hp-core=' | cut -d= -f2)"
    ac="$(printf '%s' "$top" | tr '|' '\n' | grep '^all-core=' | cut -d= -f2)"

    local ver vcode soc model plat
    ver="$(grep -E '^version=' "$MODPROP" 2>/dev/null | cut -d= -f2-)"
    vcode="$(grep -E '^versionCode=' "$MODPROP" 2>/dev/null | cut -d= -f2-)"
    model="$(cfg_get soc_model)"
    plat="$(cfg_get soc_platform)"

    local running=0
    if [ -f "$MODDIR/AppOpt.pid" ]; then
        local p
        p="$(cat "$MODDIR/AppOpt.pid" 2>/dev/null)"
        [ -n "$p" ] && kill -0 "$p" 2>/dev/null && running=1
    fi

    cat <<EOF
{"ok":true,"version":"$(printf '%s' "$ver" | json_str)","versionCode":"$(printf '%s' "$vcode" | json_str)","meizu":"$meizu","asoul":"$asoul","g83":"$g83","base":"$(base_name)","soc_model":"$(printf '%s' "$model" | json_str)","soc_platform":"$(printf '%s' "$plat" | json_str)","running":$running,"rules":{"total":$total,"base":$nbase,"meizu":$nmeizu,"asoul":$nasoul,"custom":$ncustom},"topology":{"e_core":"$(compact_cpus "$ec")","p_core":"$(compact_cpus "$pc")","hp_core":"$(compact_cpus "$hc")","all_core":"$(compact_cpus "$ac")"},"moddir":"$MODDIR"}
EOF
}

# ---------------------------------------------------------------
# apps：应用清单
#   TSV: 包名 \t 内置规则数 \t 自定义规则数 \t 是否已适配(0/1)
# ---------------------------------------------------------------
do_apps() {
    : > "$TMP/adapted"
    : > "$TMP/customcnt"
    : > "$TMP/installed"

    gen_custom

    if [ -f "$APPLIST" ] && have awk; then
        awk -F'=' -v keyfile="$TMP/keys" '
            BEGIN {
                while ((getline k < keyfile) > 0) {
                    gsub(/^[ \t]+|[ \t]+$/, "", k)
                    if (k != "") keys[k] = 1
                }
            }
            /^[[:space:]]*#/ { next }
            /=/ {
                sel = $0
                sub(/=.*$/, "", sel)
                gsub(/[ \t]/, "", sel)
                if (sel == "") next
                if (sel in keys) next
                pkg = sel
                sub(/[{:].*$/, "", pkg)
                if (pkg == "") next
                cnt[pkg]++
            }
            END { for (p in cnt) print p "\t" cnt[p] }
        ' "$APPLIST" > "$TMP/adapted"
    fi

    if [ -s "$CUSTOM" ] && have awk; then
        awk -F'\t' '
            /^[[:space:]]*#/ { next }
            NF >= 1 {
                pkg = $1
                gsub(/^[ \t]+|[ \t]+$/, "", pkg)
                if (pkg == "") next
                cnt[pkg]++
            }
            END { for (p in cnt) print p "\t" cnt[p] }
        ' "$CUSTOM" > "$TMP/customcnt"
    fi

    if have pm; then
        pm list packages -3 2>/dev/null | sed 's/^package://' | tr -d '\r' | sort -u > "$TMP/installed"
    fi

    if have awk; then
        awk -F'\t' '
            FILENAME ~ /adapted$/   { a[$1] = $2; next }
            FILENAME ~ /customcnt$/ { c[$1] = $2; next }
            FILENAME ~ /installed$/ { i[$1] = 1; next }
            END {
                for (p in a) seen[p] = 1
                for (p in c) seen[p] = 1
                for (p in i) seen[p] = 1
                for (p in seen) {
                    ar = (p in a) ? a[p] : 0
                    cr = (p in c) ? c[p] : 0
                    ad = (p in a) ? 1 : 0
                    print p "\t" ar "\t" cr "\t" ad
                }
            }
        ' "$TMP/adapted" "$TMP/customcnt" "$TMP/installed" | sort
    fi
}

# ---------------------------------------------------------------
# app <包名>：某应用的规则明细
#   TSV: 线程 \t 核心 \t 是否自定义(0/1)   （线程为 - 表示进程兜底）
# ---------------------------------------------------------------
do_app() {
    local pkg="$1"
    [ -n "$pkg" ] || result 0 "缺少包名"

    gen_custom
    : > "$TMP/seen"

    # 1) 以 applist.conf（当前生效结果）为准；选择器落在自定义集合内即为「自定义」
    if [ -f "$APPLIST" ] && have awk; then
        awk -v p="$pkg" -v keyfile="$TMP/keys" '
            BEGIN {
                while ((getline k < keyfile) > 0) {
                    gsub(/^[ \t]+|[ \t]+$/, "", k)
                    if (k != "") keys[k] = 1
                }
            }
            /^[[:space:]]*#/ { next }
            /=/ {
                line = $0
                sel = line
                sub(/=.*$/, "", sel)
                gsub(/[ \t]/, "", sel)
                core = line
                sub(/^[^=]*=/, "", core)
                gsub(/^[ \t]+|[ \t]+$/, "", core)
                if (sel == "") next
                pk = sel
                sub(/[{:].*$/, "", pk)
                if (pk != p) next
                thr = "-"
                if (sel ~ /\{/) {
                    thr = sel
                    sub(/^[^{]*\{/, "", thr)
                    sub(/\}.*$/, "", thr)
                }
                flag = (sel in keys) ? 1 : 0
                print thr "\t" core "\t" flag
                print sel > seenfile
            }
        ' seenfile="$TMP/seen" "$APPLIST"
    fi

    # 2) 兜底：自定义文件里存在但 applist.conf 尚未体现的规则
    if [ -s "$CUSTOM" ] && have awk; then
        awk -F'\t' -v p="$pkg" -v seenfile="$TMP/seen" '
            BEGIN {
                while ((getline s < seenfile) > 0) {
                    gsub(/^[ \t]+|[ \t]+$/, "", s)
                    if (s != "") seen[s] = 1
                }
            }
            /^[[:space:]]*#/ { next }
            {
                k = $1; t = $2; c = $3
                gsub(/^[ \t]+|[ \t]+$/, "", k)
                gsub(/^[ \t]+|[ \t]+$/, "", t)
                gsub(/^[ \t]+|[ \t]+$/, "", c)
                if (k != p || c == "") next
                sel = (t == "") ? k : k "{" t "}"
                if (sel in seen) next
                print ((t == "") ? "-" : t) "\t" c "\t1"
            }
        ' "$CUSTOM"
    fi
}

# ---------------------------------------------------------------
# set-rule / del-rule / reset-app / reset-all
# ---------------------------------------------------------------
validate_rule() {
    local pkg="$1" thr="$2" core="$3"
    [ -n "$pkg" ] || { result 0 "包名不能为空"; }
    case "$pkg" in
        *"{"*|*"}"*|*=*) result 0 "包名不能包含 { } = 字符" ;;
    esac
    [ -z "$thr" ] || [ "$thr" = "-" ] && return 0
    case "$thr" in
        *"{"*|*"}"*|*=*) result 0 "线程名不能包含 { } = 字符" ;;
    esac
    printf '%s' "$thr" | grep -qE '[[:space:]]' && result 0 "线程名不能含空格"
    if [ "${#thr}" -gt 15 ]; then
        result 0 "线程名超过 15 字符（内核会截断）：「$thr」实际只会匹配前 15 位"
    fi
    return 0
}

do_set_rule() {
    local pkg="$1" thr="$2" core="$3"
    [ -n "$core" ] || result 0 "缺少核心参数"
    [ "$thr" = "-" ] && thr=""
    validate_rule "$pkg" "$thr" "$core"

    printf '%s' "$core" | grep -qE "$CORE_RE" || \
        result 0 "核心名非法：$core（可用 e-core / p-core / hp-core / all-core 及组合）"

    [ -f "$CUSTOM" ] || printf '# 魅族线程 自定义规则\n# 格式：包名<TAB>线程名<TAB>核心   （线程名留空 = 进程兜底）\n' > "$CUSTOM"

    awk -F'\t' -v p="$pkg" -v t="$thr" -v c="$core" '
        BEGIN { done = 0 }
        /^[[:space:]]*#/ { print; next }
        NF >= 3 {
            k = $1; th = $2
            gsub(/^[ \t]+|[ \t]+$/, "", k)
            gsub(/^[ \t]+|[ \t]+$/, "", th)
            if (k == p && th == t) {
                if (!done) { print p "\t" t "\t" c; done = 1 }
                next
            }
            print; next
        }
        { print }
        END { if (!done) print p "\t" t "\t" c }
    ' "$CUSTOM" > "$TMP/custom.new" && mv -f "$TMP/custom.new" "$CUSTOM"

    do_apply > /dev/null 2>&1
    local sel="$pkg"
    [ -n "$thr" ] && sel="$pkg{$thr}"
    result 1 "已设置：$sel = $core"
}

do_del_rule() {
    local pkg="$1" thr="$2"
    [ "$thr" = "-" ] && thr=""
    [ -s "$CUSTOM" ] || result 0 "没有自定义规则"

    awk -F'\t' -v p="$pkg" -v t="$thr" '
        /^[[:space:]]*#/ { print; next }
        NF >= 3 {
            k = $1; th = $2
            gsub(/^[ \t]+|[ \t]+$/, "", k)
            gsub(/^[ \t]+|[ \t]+$/, "", th)
            if (k == p && th == t) next
            print; next
        }
        { print }
    ' "$CUSTOM" > "$TMP/custom.new" && mv -f "$TMP/custom.new" "$CUSTOM"

    do_apply > /dev/null 2>&1
    local sel="$pkg"
    [ -n "$thr" ] && sel="$pkg{$thr}"
    result 1 "已删除自定义规则：$sel"
}

do_reset_app() {
    local pkg="$1"
    [ -s "$CUSTOM" ] || result 0 "没有自定义规则"

    awk -F'\t' -v p="$pkg" '
        /^[[:space:]]*#/ { print; next }
        NF >= 3 {
            k = $1
            gsub(/^[ \t]+|[ \t]+$/, "", k)
            if (k == p) next
            print; next
        }
        { print }
    ' "$CUSTOM" > "$TMP/custom.new" && mv -f "$TMP/custom.new" "$CUSTOM"

    do_apply > /dev/null 2>&1
    result 1 "已清除「$pkg」的全部自定义规则"
}

do_reset_all() {
    printf '# 魅族线程 自定义规则\n# 格式：包名<TAB>线程名<TAB>核心   （线程名留空 = 进程兜底）\n' > "$CUSTOM"
    do_apply > /dev/null 2>&1
    result 1 "已清空全部自定义规则"
}

# ---------------------------------------------------------------
# update-rules：在线更新规则源文件
# ---------------------------------------------------------------
download() {
    local url="$1" out="$2"
    rm -f "$out"
    if have curl; then
        curl -fsSL --connect-timeout 15 -o "$out" "$url" || { rm -f "$out"; return 1; }
    elif have wget; then
        wget -q -T 15 -O "$out" "$url" || { rm -f "$out"; return 1; }
    else
        return 1
    fi
    [ -s "$out" ] || { rm -f "$out"; return 1; }
}

do_update_rules() {
    local ok=1 msg="" f url
    for pair in \
        "$BASE_8G3:$RAW_BASE/base/App_8G3.txt" \
        "$BASE_COMMON:$RAW_BASE/base/App_common.txt" \
        "$SRC_MEIZU:$RAW_BASE/meizu_rules.conf" \
        "$SRC_ASOUL:$RAW_BASE/asoulopt_rules.conf"
    do
        f="${pair%%:*}"; url="${pair#*:}"
        if download "$url" "$TMP/dl"; then
            cp "$TMP/dl" "$f"
            msg="$msg$(basename "$f") ✓  "
        else
            ok=0
            msg="$msg$(basename "$f") ✗  "
        fi
    done
    rm -f "$TMP/dl"

    if [ "$ok" = "1" ]; then
        cfg_set rules_time "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        do_apply > /dev/null 2>&1
        result 1 "规则已更新并重新应用：$msg"
    else
        result 0 "部分规则更新失败（请检查网络）：$msg"
    fi
}

# ---------------------------------------------------------------
# export / import
# ---------------------------------------------------------------
do_export() {
    local ts file cand try
    ts="$(date +"%Y%m%d_%H%M%S")"

    # 1) 先在临时目录生成备份内容
    {
        printf '# Meizu_Thread backup v1\n'
        printf '# 由 WebUI 导出，可用于导入恢复\n'
        printf '[config]\n'
        printf 'meizu=%s\n' "$(cfg_get meizu)"
        printf 'asoul=%s\n' "$(cfg_get asoul)"
        printf '8G3=%s\n' "$(cfg_get 8G3)"
        printf '[rules]\n'
        printf '# 格式：包名<TAB>线程名<TAB>核心（线程名留空 = 进程兜底）\n'
        if [ -s "$CUSTOM" ]; then
            # 注意：不能用 grep -E '\t'（POSIX ERE 不认 \t，GNU/toybox 皆然）
            awk -F'\t' '
                /^[[:space:]]*#/ { next }
                NF >= 3 {
                    p = $1; t = $2; c = $3
                    gsub(/^[ \t]+|[ \t]+$/, "", p)
                    gsub(/^[ \t]+|[ \t]+$/, "", t)
                    gsub(/^[ \t]+|[ \t]+$/, "", c)
                    if (p == "" || c == "") next
                    print p "\t" t "\t" c
                }
            ' "$CUSTOM"
        fi
    } > "$TMP/backup.txt"

    # 2) 依次尝试可写目录（真机优先 /sdcard/Download）
    file=""
    for cand in "$BACKUP_DIR" /sdcard/Download /storage/emulated/0/Download /sdcard /storage/emulated/0 "$MODDIR"; do
        [ -n "$cand" ] || continue
        [ -d "$cand" ] || continue
        try="$cand/Meizu_Thread_backup_$ts.txt"
        if cp "$TMP/backup.txt" "$try" 2>/dev/null && [ -s "$try" ]; then
            file="$try"
            break
        fi
        rm -f "$try" 2>/dev/null
    done

    [ -n "$file" ] || result 0 "导出失败：没有可写目录"

    local content n
    content="$(cat "$file")"
    n="$(awk 'BEGIN{n=0} /\t/{n++} END{print n+0}' "$file")"

    printf '{"ok":true,"path":"%s","count":%s,"content":"%s","msg":"已导出 %s 条自定义规则"}\n' \
        "$(printf '%s' "$file" | json_str)" "$n" "$(printf '%s' "$content" | json_str)" "$n"
}

do_import() {
    local src="$1"
    [ -n "$src" ] || result 0 "缺少文件路径"
    case "$src" in
        /*) ;;
        *) src="$MODDIR/$src" ;;
    esac

    if [ ! -f "$src" ]; then
        result 0 "文件不存在：$src"
    fi

    if ! grep -q '^\[rules\]' "$src"; then
        result 0 "不是有效的备份文件（缺少 [rules] 段）"
    fi

    : > "$TMP/imp_cfg"
    : > "$TMP/imp_rules"
    awk '
        /^\[config\]/ { s="c"; next }
        /^\[rules\]/  { s="r"; next }
        /^[[:space:]]*#/ { next }
        /^[[:space:]]*$/ { next }
        s == "c" { print > cfgfile }
        s == "r" { print > rulefile }
    ' cfgfile="$TMP/imp_cfg" rulefile="$TMP/imp_rules" "$src"

    local k v
    for k in meizu asoul 8G3; do
        v="$(grep -E "^$k=" "$TMP/imp_cfg" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r\n')"
        case "$v" in
            on|off) cfg_set "$k" "$v" ;;
        esac
    done

    printf '# 魅族线程 自定义规则\n# 格式：包名<TAB>线程名<TAB>核心   （线程名留空 = 进程兜底）\n' > "$CUSTOM"
    if have awk; then
        awk -F'\t' '
            NF >= 3 {
                p = $1; t = $2; c = $3
                gsub(/^[ \t]+|[ \t]+$/, "", p)
                gsub(/^[ \t]+|[ \t]+$/, "", t)
                gsub(/^[ \t]+|[ \t]+$/, "", c)
                if (p == "" || c == "") next
                print p "\t" t "\t" c
            }
        ' "$TMP/imp_rules" >> "$CUSTOM"
    fi

    local n
    n="$(awk -F'\t' '!/^[[:space:]]*#/ && NF>=3 && $1!="" {n++} END{print n+0}' "$CUSTOM")"

    do_apply > /dev/null 2>&1
    result 1 "导入完成：$n 条自定义规则，开关已同步"
}

# ---------------------------------------------------------------
# report：人类可读摘要（供 action.sh / 终端使用，不联网）
# ---------------------------------------------------------------
do_report() {
    local meizu asoul total ncustom top ec pc hc ac bn mz as
    meizu="$(cfg_get meizu)"; [ "$meizu" = "off" ] || meizu=on
    asoul="$(cfg_get asoul)"; [ "$asoul" = "off" ] || asoul=on

    total="$(count_rules "$APPLIST")"
    ncustom=0
    [ -s "$CUSTOM" ] && ncustom="$(awk -F'\t' '!/^[[:space:]]*#/ && NF>=3 && $1!="" {n++} END{print n+0}' "$CUSTOM")"

    bn="$(base_name)"
    mz=Off; [ "$meizu" = on ] && mz=On
    as=Off; [ "$asoul" = on ] && as=On

    echo "-------------------------------------"
    echo "📱 魅族线程配置"
    echo "   彗星底座: $bn"
    echo "   魅族专属: $mz"
    echo "   AsoulOpt : $as"
    echo "   规则总数: $total"
    echo "   自定义  : $ncustom 条"
    echo "-------------------------------------"

    top="$(topology 2>/dev/null)" || top=""
    if [ -n "$top" ]; then
        ec="$(printf '%s' "$top" | tr '|' '\n' | grep '^e-core=' | cut -d= -f2)"
        pc="$(printf '%s' "$top" | tr '|' '\n' | grep '^p-core=' | cut -d= -f2)"
        hc="$(printf '%s' "$top" | tr '|' '\n' | grep '^hp-core=' | cut -d= -f2)"
        ac="$(printf '%s' "$top" | tr '|' '\n' | grep '^all-core=' | cut -d= -f2)"
        echo "🔧 实测拓扑（符号名展开）"
        printf '   e-core  : CPU %s\n' "$(compact_cpus "$ec")"
        printf '   p-core  : CPU %s\n' "$(compact_cpus "$pc")"
        printf '   hp-core : CPU %s\n' "$(compact_cpus "$hc")"
        printf '   all-core: CPU %s\n' "$(compact_cpus "$ac")"
        echo "-------------------------------------"
    fi
}

# ---------------------------------------------------------------
# 入口分发
# ---------------------------------------------------------------
CMD="$1"; shift 2>/dev/null

case "$CMD" in
    status)       do_status ;;
    apply)        do_apply ;;
    set-flags)
        case "$1" in on|off) cfg_set meizu "$1" ;; esac
        case "$2" in on|off) cfg_set asoul "$2" ;; esac
        case "$3" in on|off) cfg_set 8G3   "$3" ;; esac
        do_apply > /dev/null 2>&1
        ;;
    update-rules) do_update_rules ;;
    report)       do_report ;;
    apps)         do_apps ;;
    app)          do_app "$1" ;;
    set-rule)     do_set_rule "$1" "$2" "$3" ;;
    del-rule)     do_del_rule "$1" "$2" ;;
    reset-app)    do_reset_app "$1" ;;
    reset-all)    do_reset_all ;;
    export)       do_export ;;
    import)       do_import "$1" ;;
    topology)
        topology || result 0 "无法探测拓扑"
        printf '\n'
        ;;
    *)
        printf '{"ok":false,"msg":"未知子命令：%s"}\n' "$(printf '%s' "$CMD" | json_str)"
        exit 1
        ;;
esac
