# -*- coding: utf-8 -*-
"""验证生成的 applist.conf 正确性"""
import io, os, re, collections

REPO = r"C:\xiancheng\创作工作\03_魅族线程_Meizu_Thread"
RS   = r"C:\xiancheng\_sources_原始素材\RS2.0.2daily\applist.conf"
APPLIST = os.path.join(REPO, "applist.conf")

txt = io.open(APPLIST, encoding="utf-8").read()
lines = txt.splitlines()

rules = []
for i, l in enumerate(lines, 1):
    s = l.strip()
    if not s or s.startswith("#"):
        continue
    if "=" not in s:
        print(f"  !! 第 {i} 行无 '=': {s[:60]}")
        continue
    lhs, rhs = s.rsplit("=", 1)
    rules.append((i, lhs.strip(), rhs.strip()))

print(f"总规则数: {len(rules)}")

# --- 1. 核心目标合法性（支持逗号并集的复合表达式，如 p-core,hp-core）---
allowed = {"e-core", "p-core", "hp-core", "all-core"}
bad_target = []
for i, l, r in rules:
    toks = [t.strip() for t in r.split(",") if t.strip()]
    if not toks or any(t not in allowed for t in toks):
        bad_target.append((i, l, r))
print(f"\n[1] 含非法核心 token 的规则: {len(bad_target)}")
for i, l, r in bad_target[:20]:
    print(f"    第{i}行 {l} = {r}")

# --- 2. 魅族规则完整性（对比 RS 源）---
rs_meizu = {}
for l in io.open(RS, encoding="utf-8"):
    s = l.strip()
    if not s or s.startswith("#"):
        continue
    pkg = re.split(r"[={:]", s)[0].strip()
    if pkg.startswith("com.meizu.") or pkg.startswith("com.flyme."):
        rs_meizu[s.split("=", 1)[0].strip()] = s.split("=", 1)[1].strip()

MAP = {"0-1": "e-core", "2-5": "p-core", "4-5": "hp-core"}
# 进程级兜底（裸 `包名=X`）不映射为 hp-core，改用 e-core,p-core —— 见 gen_meizu_rules.py 说明
FALLBACK = "e-core,p-core"
app_meizu = {}
for i, l, r in rules:
    pkg = re.split(r"[={:]", l)[0].strip()
    if pkg.startswith("com.meizu.") or pkg.startswith("com.flyme."):
        app_meizu[l] = r

print(f"\n[2] 魅族规则")
print(f"    RS 源:      {len(rs_meizu)} 条")
print(f"    applist:    {len(app_meizu)} 条")

missing = []
for k, v in rs_meizu.items():
    if k not in app_meizu:
        # 允许 flyme.launcher 主线程名被修正为 .flyme.launcher
        alt = k.replace("{flyme.launcher}", "{.flyme.launcher}")
        if alt not in app_meizu:
            missing.append((k, v))
print(f"    缺失:       {len(missing)}")
for k, v in missing[:20]:
    print(f"      - {k} = {v}")

# 值映射校验
wrong = []
for k, v in rs_meizu.items():
    alt = k.replace("{flyme.launcher}", "{.flyme.launcher}")
    got = app_meizu.get(k, app_meizu.get(alt))
    # 进程级兜底（无 {} 且无 :）期望 FALLBACK，其余按 MAP
    is_fallback = ("{" not in k) and (":" not in k)
    exp = FALLBACK if is_fallback else MAP.get(v, v)
    if got is not None and got != exp:
        wrong.append((k, v, exp, got))
print(f"    映射错误:   {len(wrong)}")
for k, v, exp, got in wrong[:20]:
    print(f"      - {k}: 原{v} -> 期望{exp} 实际{got}")

# --- 3. 魅族包名覆盖 ---
rs_pkgs = {re.split(r"[={:]", k)[0].strip() for k in rs_meizu}
app_pkgs = {re.split(r"[={:]", k)[0].strip() for k in app_meizu}
print(f"\n[3] 魅族包覆盖: RS={len(rs_pkgs)}  applist={len(app_pkgs)}")
print(f"    缺失包: {sorted(rs_pkgs - app_pkgs) if rs_pkgs - app_pkgs else '无'}")

# --- 4. AsoulOpt 覆盖 ---
asoul_txt = io.open(os.path.join(REPO, "asoulopt_rules.conf"), encoding="utf-8").read()
entries = {m.group(1) for m in re.finditer(r"^\*([^*]+)\*=", asoul_txt, re.M)}
print(f"\n[4] AsoulOpt 条目: {len(entries)}")

# --- 5. 线程名 15 字符检查 ---
over = []
for i, l, r in rules:
    m = re.search(r"\{([^}]*)\}", l)
    if not m:
        continue
    thr = m.group(1)
    if any(c in thr for c in "*?["):
        continue
    if len(thr) > 15:
        over.append((i, l, thr, len(thr)))
print(f"\n[5] 精确线程名超过 15 字符: {len(over)}")
for i, l, thr, n in over[:20]:
    print(f"    第{i}行 len={n} {thr!r}")

# --- 6. 重复规则 ---
keys = collections.Counter((l, r) for i, l, r in rules)
dups = [(k, c) for k, c in keys.items() if c > 1]
print(f"\n[6] 完全相同(选择器+目标)的重复规则: {len(dups)}")
for (l, r), c in dups[:20]:
    print(f"    x{c}  {l}={r}")

print("\n===== 验证完成 =====")
