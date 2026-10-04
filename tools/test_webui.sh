#!/bin/sh
# ============================================================
# webui.sh 后端自检
#
# 在临时副本上运行，不会修改仓库内的任何文件。
# 可在 PC 的 Git bash，也可在设备上直接执行：
#     sh tools/test_webui.sh
# ============================================================

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

PASS=0
FAIL=0
pass() { printf '  [PASS] %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL + 1)); }
ok()   { if [ "$2" = "$3" ]; then pass "$1 = $2"; else fail "$1: 期望 [$3]，实际 [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -q "$3"; then pass "$1"; else fail "$1（未匹配 $3）"; fi; }

WORK=$(mktemp -d 2>/dev/null) || WORK="/tmp/meizu_test.$$"
mkdir -p "$WORK/base"
for f in webui.sh module.prop confige.txt custom_rules.tsv \
         meizu_rules.conf asoulopt_rules.conf applist.conf; do
    [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$WORK/$f"
done
for f in App_8G3.txt App_common.txt; do
    [ -f "$ROOT/base/$f" ] && cp "$ROOT/base/$f" "$WORK/base/$f"
done

cd "$WORK" || exit 1

# 计数工具
rules() { grep -cE '^[^#[:space:]][^=]*=' applist.conf 2>/dev/null | tr -d ' '; }
dups()  { sed 's/=.*$//' applist.conf 2>/dev/null | grep -vE '^[[:space:]]*#|^[[:space:]]*$' | sort | uniq -d | wc -l | tr -d ' '; }
cust()  { awk -F'\t' '!/^[[:space:]]*#/ && NF>=3 && $1!="" {n++} END{print n+0}' custom_rules.tsv; }

printf '\n=== 1. 语法与初始化 ===\n'
if sh -n webui.sh 2>/dev/null; then pass "webui.sh 语法检查"; else fail "webui.sh 语法错误"; fi

printf '\n=== 2. apply 生成规则 ===\n'
sh webui.sh apply > /dev/null 2>&1
BASE_N=$(rules)
[ "$BASE_N" -gt 3000 ] && pass "规则数合理 ($BASE_N)" || fail "规则数异常 ($BASE_N)"
ok "重复选择器" "$(dups)" "0"

printf '\n=== 3. 与仓库基线逐字节比对 ===\n'
if [ -f "$ROOT/applist.conf" ]; then
    grep -vE '^[[:space:]]*#|^[[:space:]]*$' applist.conf > "$WORK/a.body"
    grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$ROOT/applist.conf" > "$WORK/b.body"
    if diff "$WORK/a.body" "$WORK/b.body" > /dev/null 2>&1; then
        pass "规则体与仓库基线完全一致"
    else
        fail "规则体与仓库基线不一致"
    fi
else
    printf '  ⏭  跳过（无基线 applist.conf）\n'
fi

printf '\n=== 4. 覆盖已适配应用 ===\n'
sh webui.sh set-rule com.tencent.mm RenderThread hp-core > /dev/null 2>&1
ok "覆盖后条数不变" "$(rules)" "$BASE_N"
ok "重复选择器" "$(dups)" "0"
has "规则已替换" "$(grep 'com.tencent.mm{RenderThread}' applist.conf)" '=hp-core'

printf '\n=== 5. 为未适配应用新增 ===\n'
sh webui.sh set-rule com.example.newapp - p-core > /dev/null 2>&1
sh webui.sh set-rule com.example.newapp MyRenderThread hp-core > /dev/null 2>&1
ok "新增后条数 +2" "$(rules)" "$((BASE_N + 2))"
ok "重复选择器" "$(dups)" "0"
ok "自定义条数" "$(cust)" "3"

printf '\n=== 6. 校验拒绝非法输入 ===\n'
has "拒绝非法核心名" "$(sh webui.sh set-rule com.a.b T e-coreX 2>&1)" '"ok":false'
has "拒绝超 15 字符线程名" "$(sh webui.sh set-rule com.a.b ThisThreadNameIsWayTooLong e-core 2>&1)" '"ok":false'

printf '\n=== 7. 删除与还原 ===\n'
sh webui.sh del-rule com.tencent.mm RenderThread > /dev/null 2>&1
has "回退为内置" "$(grep 'com.tencent.mm{RenderThread}' applist.conf)" 'p-core,hp-core'
sh webui.sh reset-app com.example.newapp > /dev/null 2>&1
ok "reset-app 后条数" "$(rules)" "$BASE_N"

printf '\n=== 8. 备份 / 导入 往返 ===\n'
sh webui.sh set-rule com.example.demo DemoThread hp-core > /dev/null 2>&1
sh webui.sh set-rule com.example.demo2 - p-core > /dev/null 2>&1
BEFORE=$(cust)
JSON=$(sh webui.sh export 2>&1)
has "导出成功" "$JSON" '"ok":true'
BK=$(ls -t "$WORK"/Meizu_Thread_backup_*.txt 2>/dev/null | head -1)
if [ -n "$BK" ]; then
    OKRULES=$(awk 'BEGIN{n=0} /\t/{n++} END{print n+0}' "$BK")
    ok "备份含规则条数" "$OKRULES" "$BEFORE"
    sh webui.sh reset-all > /dev/null 2>&1
    ok "清空后自定义" "$(cust)" "0"
    sh webui.sh import "$BK" > /dev/null 2>&1
    ok "导入后自定义" "$(cust)" "$BEFORE"
else
    fail "未找到导出的备份文件"
fi

printf '\n=== 9. 关闭魅族段 ===\n'
sh webui.sh set-flags off on on > /dev/null 2>&1
LAUNCHER=$(grep -c 'com.meizu.flyme.launcher' applist.conf)
[ "$LAUNCHER" -gt 0 ] && pass "底座 launcher 规则回归 ($LAUNCHER 条)" || fail "关闭魅族段后 launcher 规则缺失"
ok "重复选择器" "$(dups)" "0"
sh webui.sh set-flags on on on > /dev/null 2>&1

printf '\n=== 10. status 与 apps ===\n'
ST=$(sh webui.sh status 2>&1)
has "status ok" "$ST" '"ok":true'
has "status 含拓扑" "$ST" '"topology"'
has "status 含规则统计" "$ST" '"rules"'
APPS=$(sh webui.sh apps 2>&1 | grep -c .)
[ "$APPS" -gt 100 ] && pass "apps 返回 $APPS 行" || fail "apps 行数异常 ($APPS)"
ok "app 明细列数" "$(sh webui.sh app com.tencent.mm 2>&1 | head -1 | awk -F'\t' '{print NF}')" "3"

printf '\n=== 11. 恢复默认开关 ===\n'
sh webui.sh reset-all > /dev/null 2>&1
sh webui.sh apply > /dev/null 2>&1
ok "规则数回到基线" "$(rules)" "$BASE_N"
ok "重复选择器" "$(dups)" "0"

rm -rf "$WORK"

printf '\n============================================\n'
if [ "$FAIL" -eq 0 ]; then
    printf '  全部通过  (%s 项)\n' "$PASS"
else
    printf '  %s 项失败  (%s 项通过)\n' "$FAIL" "$PASS"
fi
printf '============================================\n\n'
[ "$FAIL" -eq 0 ]
