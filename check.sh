#!/system/bin/sh
# ============================================================
# 魅族线程 · 运行状态自检
#
# 在设备上以 root 运行：
#     su -c sh /data/adb/modules/Meizu_Thread/check.sh
#     su -c sh /data/adb/modules/Meizu_Thread/check.sh com.tencent.mm   # 详查某应用
#     su -c sh /data/adb/modules/Meizu_Thread/check.sh --selftest       # 自检脚本本身
#
# 思路：线程绑核的「唯一事实」是 /proc/<tid>/status 的 Cpus_allowed_list。
#       本脚本把它与 applist.conf 中该线程应得的规则做对照，
#       并给出 /proc/<tid>/cpuset 以判断「是谁在约束它」。
# ============================================================

MODDIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -f "$MODDIR/module.prop" ] || MODDIR=/data/adb/modules/Meizu_Thread

APPLIST="$MODDIR/applist.conf"
CUSTOM="$MODDIR/custom_rules.tsv"
PIDFILE="$MODDIR/AppOpt.pid"
LOG="$MODDIR/affinity_manager.log"
RULE_TMP="${TMPDIR:-/tmp}/meizu_rules.$$"

TARGET="$1"

E_CPUS=""; P_CPUS=""; H_CPUS=""; ALL_CPUS=""

cleanup() { rm -f "$RULE_TMP" "$RULE_TMP.2"; }
trap cleanup EXIT HUP INT TERM

# ---------------------------------------------------------------
# 工具
# ---------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

# CPU 列表归一化：0-1,5 → 0,1,5
# 注意：必须用 printf '%s\n' 补上结尾换行，否则 while read 会丢掉最后一段
#       （read 在 EOF 且无换行时返回非 0，循环体不执行）
norm_cpus() {
    printf '%s\n' "$1" | tr ',' '\n' | while IFS= read -r seg; do
        seg=$(printf '%s' "$seg" | tr -d ' ')
        [ -n "$seg" ] || continue
        case "$seg" in
            *-*)
                a=${seg%-*}; b=${seg#*-}
                case "$a$b" in *[!0-9]*) printf '%s\n' "$seg"; continue ;; esac
                i=$a
                while [ "$i" -le "$b" ]; do printf '%s\n' "$i"; i=$((i + 1)); done
                ;;
            *) printf '%s\n' "$seg" ;;
        esac
    done | sort -n | uniq | tr '\n' ',' | sed 's/,$//'
}

# 拓扑探测（与 webui.sh 一致）
detect_topo() {
    local groups n i line freq cpus
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

    n="$(printf '%s\n' "$groups" | wc -l | tr -d ' ')"
    E_CPUS=""; P_CPUS=""; H_CPUS=""; ALL_CPUS=""
    i=0
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        cpus="${line#* }"
        i=$((i + 1))
        if [ "$i" -eq 1 ]; then
            E_CPUS="$cpus"
        elif [ "$i" -eq "$n" ]; then
            H_CPUS="$cpus"
        else
            if [ -z "$P_CPUS" ]; then P_CPUS="$cpus"; else P_CPUS="$P_CPUS,$cpus"; fi
        fi
        if [ -z "$ALL_CPUS" ]; then ALL_CPUS="$cpus"; else ALL_CPUS="$ALL_CPUS,$cpus"; fi
    done <<EOF
$groups
EOF
    [ -n "$P_CPUS" ] || P_CPUS="$E_CPUS"
    return 0
}

# 核心符号 → 实际 CPU 列表
expand_core() {
    local core tok add out
    core="$1"
    out=""
    for tok in $(printf '%s' "$core" | tr ',' ' '); do
        case "$tok" in
            e-core)  add="$E_CPUS" ;;
            p-core)  add="$P_CPUS" ;;
            hp-core) add="$H_CPUS" ;;
            all-core) add="$ALL_CPUS" ;;
            *)       add="$tok" ;;
        esac
        out="$out,$add"
    done
    norm_cpus "$out"
}

# 取某进程名对应的规则（TSV: 线程名<TAB>核心；线程名空 = 进程兜底）
rules_for_name() {
    [ -f "$APPLIST" ] || return 0
    awk -v name="$1" '
        function glob2re(p,   i, c, out) {
            out = ""
            for (i = 1; i <= length(p); i++) {
                c = substr(p, i, 1)
                if (c == "*") out = out ".*"
                else if (c == "?") out = out "."
                else if (c ~ /[.+()\[\]{}^$|\\]/) out = out "\\" c
                else out = out c
            }
            return "^" out "$"
        }
        /^[[:space:]]*#/ { next }
        /=/ {
            line = $0
            sel = line; sub(/=.*$/, "", sel); gsub(/[ \t]/, "", sel)
            core = line; sub(/^[^=]*=/, "", core); gsub(/^[ \t]+|[ \t]+$/, "", core)
            if (sel == "" || core == "") next
            pkg = sel; thr = ""
            if (sel ~ /\{/) {
                pkg = sel; sub(/\{.*$/, "", pkg)
                thr = sel; sub(/^[^{]*\{/, "", thr); sub(/\}.*$/, "", thr)
            }
            if (name ~ glob2re(pkg)) {
                # 进程级规则（thread 为空）用 "-" 占位：
                # shell 的 read 配 IFS=制表符 会把「前导制表符」当空白吃掉，
                # 导致空字段丢失，故不能用真正的空字符串。
                print ((thr == "") ? "-" : thr) "\t" core
            }
        }
    ' "$APPLIST"
}

# 在规则文件中为某线程名找核心（精确线程优先，其次进程兜底）
match_core() {
    local rf="$1" comm="$2" rth rcore
    while IFS="$(printf '\t')" read -r rth rcore; do
        [ -n "$rth" ] || continue
        [ "$rth" = "-" ] && continue
        case "$comm" in $rth) printf '%s' "$rcore"; return 0 ;; esac
    done < "$rf"
    while IFS="$(printf '\t')" read -r rth rcore; do
        [ "$rth" = "-" ] || continue
        printf '%s' "$rcore"; return 0
    done < "$rf"
    return 1
}

# 某进程名的所有 PID
pids_for_name() {
    local n="$1" d cl
    for d in /proc/[0-9]*; do
        [ -r "$d/cmdline" ] || continue
        cl="$(tr '\0' '\n' < "$d/cmdline" 2>/dev/null | head -n1)"
        case "$cl" in
            "$n" | "$n":*) printf '%s\n' "${d#/proc/}" ;;
        esac
    done
}

ALLOWED() { awk '/^Cpus_allowed_list/{print $2}' "$1" 2>/dev/null; }
CSET()    { cat "$1" 2>/dev/null; }

# ===============================================================
# 自检模式（在 PC 上验证脚本逻辑，不依赖设备）
# ===============================================================
if [ "$TARGET" = "--selftest" ]; then
    P=0; F=0
    ck() { if [ "$2" = "$3" ]; then printf '  [PASS] %s = %s\n' "$1" "$2"; P=$((P + 1));
           else printf '  [FAIL] %s: 期望 %s，实际 %s\n' "$1" "$3" "$2"; F=$((F + 1)); fi; }

    printf '\n=== norm_cpus ===\n'
    ck "0-1"        "$(norm_cpus '0-1')"        "0,1"
    ck "0,1,5"      "$(norm_cpus '0,1,5')"      "0,1,5"
    ck "0-3,6"      "$(norm_cpus '0-3,6')"      "0,1,2,3,6"
    ck "5-6,0-1"    "$(norm_cpus '5-6,0-1')"    "0,1,5,6"
    ck "重复 0,0,1" "$(norm_cpus '0,0,1')"      "0,1"
    ck "空"         "$(norm_cpus '')"           ""

    printf '\n=== expand_core（模拟魅族21 2+3+2+1）===\n'
    E_CPUS="0-1"; P_CPUS="2-4"; H_CPUS="5-6"; ALL_CPUS="0-1,2-4,5-6"
    ck "e-core"            "$(expand_core 'e-core')"            "0,1"
    ck "p-core"            "$(expand_core 'p-core')"            "2,3,4"
    ck "hp-core"           "$(expand_core 'hp-core')"           "5,6"
    ck "p-core,hp-core"    "$(expand_core 'p-core,hp-core')"    "2,3,4,5,6"
    ck "e-core,p-core"     "$(expand_core 'e-core,p-core')"     "0,1,2,3,4"
    ck "all-core"          "$(expand_core 'all-core')"          "0,1,2,3,4,5,6"
    ck "数字原样"          "$(expand_core '0-3')"               "0,1,2,3"

    printf '\n=== 规则匹配（模拟引擎的选择器语义）===\n'
    TESTLIST="${TMPDIR:-/tmp}/meizu_st_applist.$$"
    cat > "$TESTLIST" <<'TESTEOF'
# 注释行应被忽略
com.tencent.mm{RenderThread}=p-core,hp-core
com.tencent.mm=hp-core
com.tencent.mm:qzone=hp-core
*Nekootan.kfkj*=p-core
com.foo{binder*}=e-core
com.bar{Foo}=all-core
com.bar=hp-core
TESTEOF
    SAVED_APPLIST="$APPLIST"
    APPLIST="$TESTLIST"

    rc() { rules_for_name "$1" > "$RULE_TMP"; match_core "$RULE_TMP" "$2"; }

    ck "精确线程优先于兜底"   "$(rc com.tencent.mm RenderThread)"        "p-core,hp-core"
    ck "无精确则用进程兜底"   "$(rc com.tencent.mm AnotherThread)"       "hp-core"
    ck "带花括号的精确线程"   "$(rc com.bar Foo)"                        "all-core"
    ck "子进程用自身规则"     "$(rc com.tencent.mm:qzone Anything)"      "hp-core"
    ck "主进程规则不误配子进程" "$(rc com.tencent.mm:qzone RenderThread)" "hp-core"
    ck "通配包名"             "$(rc com.Nekootan.kfkj.android main)"     "p-core"
    ck "通配线程名"           "$(rc com.foo binder:1234_5)"              "e-core"
    ck "通配线程不误配"       "$(rc com.foo OtherThread)"                ""
    ck "未适配应用无规则"     "$(rc com.unknown.app X)"                  ""

    APPLIST="$SAVED_APPLIST"
    rm -f "$TESTLIST"

    printf '\n=== 结果 ===\n'
    if [ "$F" -eq 0 ]; then printf '  全部通过 (%s 项)\n\n' "$P"; else printf '  %s 项失败\n\n' "$F"; fi
    [ "$F" -eq 0 ]
    exit $?
fi

# ===============================================================
# 1. 权限与模块文件
# ===============================================================
printf '\n========================================\n'
printf ' 魅族线程 · 运行状态自检\n'
printf '========================================\n\n'

printf '[1] 权限与模块\n'
if [ "$(id -u 2>/dev/null)" = "0" ]; then
    printf '  root            : 是\n'
else
    printf '  root            : 否  ⚠️ 请用 su 运行，否则无法读取 /proc\n'
fi
printf '  模块目录        : %s\n' "$MODDIR"
[ -f "$MODDIR/module.prop" ] && printf '  模块已安装      : 是\n' || printf '  模块已安装      : 否 ❌\n'

if [ -x "$MODDIR/AppOpt" ]; then
    printf '  AppOpt 二进制   : 存在且可执行\n'
else
    printf '  AppOpt 二进制   : 缺失或不可执行 ❌\n'
fi

if [ -f "$APPLIST" ]; then
    RULE_N=$(grep -cE '^[^#[:space:]][^=]*=' "$APPLIST" 2>/dev/null | tr -d ' ')
    printf '  applist.conf    : 存在，%s 条规则\n' "$RULE_N"
else
    printf '  applist.conf    : 缺失 ❌（请先在 WebUI 点「应用配置」）\n'
    RULE_N=0
fi

CUST_N=0
[ -s "$CUSTOM" ] && CUST_N="$(awk -F'\t' '!/^[[:space:]]*#/ && NF>=3 && $1!="" {n++} END{print n+0}' "$CUSTOM")"
printf '  自定义规则      : %s 条\n' "$CUST_N"

# ===============================================================
# 2. AppOpt 进程
# ===============================================================
printf '\n[2] AppOpt 进程\n'
PID=""
[ -f "$PIDFILE" ] && PID="$(cat "$PIDFILE" 2>/dev/null | tr -d ' \r\n')"
printf '  PID 文件        : %s\n' "${PID:-（无）}"

ALIVE=0
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    ALIVE=1
    printf '  进程状态        : 运行中 ✅\n'
    printf '  命令行          : %s\n' "$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null)"
    printf '  已运行          : %s\n' "$(ps -o etime= -p "$PID" 2>/dev/null | tr -d ' ')"
else
    printf '  进程状态        : 未运行 ❌\n'
    OTHER="$(pids_for_name "$MODDIR/AppOpt" | head -n1)"
    [ -z "$OTHER" ] && OTHER="$(ps -A 2>/dev/null | grep -w AppOpt | awk '{print $2}' | head -n1)"
    if [ -n "$OTHER" ]; then
        printf '  但发现进程      : PID %s（PID 文件可能过期）\n' "$OTHER"
        ALIVE=1
    else
        printf '  → 请重启手机，或手动执行：\n'
        printf '     su -c "%s/AppOpt" -c "%s/applist.conf" -b AkiAppOpt &\n' "$MODDIR" "$MODDIR"
    fi
fi

# ===============================================================
# 3. 日志告警（规则是否被引擎接受）
# ===============================================================
printf '\n[3] 日志告警\n'
if [ -f "$LOG" ]; then
    BAD="$(grep -c '无效 CPU 范围' "$LOG" 2>/dev/null | tr -d ' ')"
    BAD2="$(grep -c '无有效 CPU' "$LOG" 2>/dev/null | tr -d ' ')"
    printf '  日志文件        : %s\n' "$LOG"
    printf '  「无效 CPU 范围」: %s\n' "${BAD:-0}"
    printf '  「无有效 CPU」   : %s\n' "${BAD2:-0}"
    if [ "${BAD:-0}" != "0" ] || [ "${BAD2:-0}" != "0" ]; then
        printf '  ⚠️  存在被丢弃的规则，样例：\n'
        grep -E '无效 CPU 范围|无有效 CPU' "$LOG" 2>/dev/null | tail -n 5 | sed 's/^/     /'
    else
        printf '  ✅ 无规则被丢弃\n'
    fi
else
    printf '  日志文件        : 不存在（%s）\n' "$LOG"
    printf '  ℹ️  引擎未产生日志。若进程在跑但无日志，请确认 -b 参数与模块目录可写。\n'
fi

# ===============================================================
# 4. 拓扑与符号展开
# ===============================================================
printf '\n[4] 本机拓扑与符号展开\n'
if detect_topo; then
    printf '  e-core   → CPU %s\n' "$(norm_cpus "$E_CPUS")"
    printf '  p-core   → CPU %s\n' "$(norm_cpus "$P_CPUS")"
    printf '  hp-core  → CPU %s\n' "$(norm_cpus "$H_CPUS")"
    printf '  all-core → CPU %s\n' "$(norm_cpus "$ALL_CPUS")"
    NCLUSTER="$(printf '%s\n' "$E_CPUS" "$P_CPUS" "$H_CPUS" | grep -c .)"
    printf '  簇数            : %s\n' "$NCLUSTER"
else
    printf '  ❌ 无法探测 cpufreq，符号名无法展开\n'
fi

# ===============================================================
# 5. cpuset 结构
# ===============================================================
printf '\n[5] cpuset 结构\n'
CS_ROOT=""
for d in /dev/cpuset/AkiAppOpt "$MODDIR/AkiAppOpt"; do
    [ -d "$d" ] && { CS_ROOT="$d"; break; }
done
if [ -n "$CS_ROOT" ]; then
    printf '  基目录          : %s ✅\n' "$CS_ROOT"
    for sub in "$CS_ROOT"/*; do
        [ -d "$sub" ] || continue
        TASKS=0
        [ -r "$sub/tasks" ] && TASKS="$(wc -l < "$sub/tasks" 2>/dev/null | tr -d ' ')"
        printf '    %-12s 任务数=%s\n' "$(basename "$sub")" "$TASKS"
    done
else
    printf '  基目录          : 未找到\n'
    printf '  ℹ️  可能路径：/dev/cpuset/AkiAppOpt 。\n'
    printf '      若确实不存在，说明引擎未使用 cpuset 方式（可能直接 sched_setaffinity），\n'
    printf '      此时以第 6 节的 Cpus_allowed_list 为准。\n'
fi

# ===============================================================
# 6. 实测：线程亲和性 vs 规则期望
# ===============================================================
printf '\n[6] 实测线程绑核\n'

report_app() {
    name="$1"
    FULL="$2"
    pids="$(pids_for_name "$name" | head -n 3)"
    [ -n "$pids" ] || return 1
    rules_for_name "$name" > "$RULE_TMP"
    [ -s "$RULE_TMP" ] || return 1

    printf '\n  ── %s\n' "$name"
    for pid in $pids; do
        printf '     PID %s\n' "$pid"
        [ -d "/proc/$pid/task" ] || continue
        MATCH=0; OKN=0; BADN=0
        for t in /proc/"$pid"/task/*; do
            [ -d "$t" ] || continue
            tid="${t##*/}"
            comm="$(cat "$t/comm" 2>/dev/null)"
            exp_core="$(match_core "$RULE_TMP" "$comm")" || continue
            MATCH=$((MATCH + 1))
            exp="$(expand_core "$exp_core")"
            act_raw="$(ALLOWED "$t/status")"
            act="$(norm_cpus "$act_raw")"
            cs="$(CSET "/proc/$tid/cpuset")"
            if [ "$act" = "$exp" ]; then
                OKN=$((OKN + 1))
                if [ "$FULL" = "1" ]; then
                    printf '       ✅ %-16s %-10s 规则=%-16s 期望=%s\n' "$comm" "$act_raw" "$exp_core" "$exp"
                fi
            else
                BADN=$((BADN + 1))
                printf '       ❌ %-16s 实际=%-10s 期望=%-10s 规则=%s cpuset=%s\n' \
                    "$comm" "${act_raw:-?}" "$exp" "$exp_core" "${cs:-?}"
            fi
        done
        printf '       匹配规则线程 %s 个：正常 %s，异常 %s\n' "$MATCH" "$OKN" "$BADN"
        [ "$BADN" -eq 0 ] && [ "$MATCH" -gt 0 ] && printf '       ✅ 该进程绑核符合规则\n'
    done
    return 0
}

if [ -n "$TARGET" ] && [ "$TARGET" != "--selftest" ]; then
    printf '  详查目标：%s\n' "$TARGET"
    report_app "$TARGET" 1 || {
        printf '  ⚠️  未找到该应用的活动进程，或它没有任何规则。\n'
        printf '      请先启动该应用，并确认它已在规则清单内：\n'
        printf '      sh %s/webui.sh app %s\n' "$MODDIR" "$TARGET"
    }
else
    printf '  （自动抽样：挑最多 3 个正在运行且带规则的进程）\n'
    FOUND=0
    for d in /proc/[0-9]*; do
        [ -r "$d/cmdline" ] || continue
        cl="$(tr '\0' '\n' < "$d/cmdline" 2>/dev/null | head -n1)"
        [ -n "$cl" ] || continue
        case "$cl" in
            */*|*" "*) continue ;;
        esac
        report_app "$cl" 0 >/dev/null 2>&1 || continue
        report_app "$cl" 0
        FOUND=$((FOUND + 1))
        [ "$FOUND" -ge 3 ] && break
    done
    if [ "$FOUND" -eq 0 ]; then
        printf '  ⚠️  没有找到「正在运行且有规则」的进程。\n'
        printf '      请先启动一个已适配的应用（如微信、浏览器、桌面），再运行本脚本。\n'
    fi
fi

# ===============================================================
# 结论
# ===============================================================
printf '\n========================================\n'
printf ' 判读要点\n'
printf '========================================\n'
printf ' 1) [2] 必须「运行中」；未运行则规则不会生效。\n'
printf ' 2) [3] 两个计数必须为 0，否则有规则被引擎丢弃。\n'
printf ' 3) [4] 的展开结果应与机型预期一致（魅族21 为 2+3+2+1）。\n'
printf ' 4) [6] 的「异常」为 0 才算绑核真正生效：\n'
printf '      · 实际 = 期望            → 正常\n'
printf '      · 实际 ≠ 期望 且 cpuset=/AkiAppOpt/... → 引擎生效了但结果不符，请反馈\n'
printf '      · 实际 ≠ 期望 且 cpuset=/top-app 等  → 被 Android 自身 cpuset 覆盖\n'
printf '      · 实际 = 0-7（全部核心）           → 规则未匹配到该线程\n'
printf ' 5) 改规则后无需重启：在 WebUI 保存后再跑本脚本，应即时反映。\n'
printf '\n'
