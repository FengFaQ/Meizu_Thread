# -*- coding: utf-8 -*-
"""
组装最终 applist.conf

⚠️ 自 2.0 起，applist.conf 由模块内的 `webui.sh apply` 在运行时生成，
   本脚本仅作为**构建期参考实现与等价性校验基准**保留。
   （两者生成的「规则体」已验证逐字节一致；差异仅在文件头注释。）

   运行 `sh webui.sh apply` 即可重新生成，WebUI 每次改动配置也会自动调用。

结构（按加载顺序，越靠前越先写入；引擎按优先级与规则顺序匹配）：
    1. 彗星 App_8G3    —— 彗星的日用应用规则（底座）
    2. 彗星 Game_8G3   —— 【已移除】被 AsoulOpt 段替换
    3. 魅族专属段       —— 从 RS2.0.2daily 完整提取
    4. AsoulOpt 游戏段  —— 独立部分，替换彗星游戏规则

冲突处理：
    彗星原有 com.meizu.flyme.launcher 规则与 RS 提取的魅族规则重复，
    以 RS（魅族专用来源）为准，故从彗星段中删除该包。
    —— 此「包级覆盖」规则已同步实现在 webui.sh 的 build_pkg_set / filter_source。
"""
import io, os, re

COMET = r"C:\xiancheng\创作工作\01_彗星线程_Comet-Thread-Opt"
REPO  = r"C:\xiancheng\创作工作\03_魅族线程_Meizu_Thread"

MEIZU = os.path.join(REPO, "meizu_rules.conf")
ASOUL = os.path.join(REPO, "asoulopt_rules.conf")
OUT   = os.path.join(REPO, "applist.conf")

def read(p):
    return io.open(p, encoding="utf-8", errors="replace").read()

# ---- 1. 彗星底座，剔除与魅族段冲突的包 ----
# 使用已符号化的副本（base/App_8G3.txt），而非原始仓库文件；
# 原始文件含写死的 2+3+2+1 编号，符号化后由引擎按实测拓扑展开。
base_src = os.path.join(REPO, "base", "App_8G3.txt")
if not os.path.isfile(base_src):
    raise SystemExit("缺少符号化底座，请先运行 symbolize_base.py")
app_lines = read(base_src).splitlines()

# 收集魅族段已覆盖的包名（避免重复定义）
meizu_txt = read(MEIZU)
meizu_pkgs = set()
for l in meizu_txt.splitlines():
    if l.startswith("#") or "=" not in l:
        continue
    meizu_pkgs.add(re.split(r"[={:]", l)[0].strip())

kept, dropped = [], []
for l in app_lines:
    s = l.strip()
    if s and not s.startswith("#") and "=" in s:
        pkg = re.split(r"[={:]", s)[0].strip()
        if pkg in meizu_pkgs:
            dropped.append(s)
            continue
    kept.append(l)

print(f"彗星 App_8G3: 保留 {len(kept)} 行, 因魅族段覆盖而移除 {len(dropped)} 行")
for d in dropped:
    print("   -", d)

# ---- 2. 组装 ----
parts = []
parts.append("""# ============================================================
# 魅族 21 (骁龙 8 Gen 3) 专属线程配置
# ============================================================
# 底座：Comet Thread Opt (彗星线程) App_8G3
# 魅族段：提取自 RS2.0.2daily 的全部 com.meizu.* / com.flyme.* 规则
# 游戏段：AsoulOpt 支持列表（独立部分，已替换彗星原游戏规则）
#
# 本文件由构建脚本自动生成，请勿手工编辑；
# 修改请改 gen_*.py 或对应源文件后重新构建。
#
# 引擎：AkiAppOpt（支持 e-core / p-core / hp-core / all-core 符号名，
#       按设备实测 CPU 拓扑在运行时展开）
# ============================================================
""")

parts.append("""
# ============================================================
# 第一部分：彗星日用应用规则 (App_8G3)
# ============================================================
""")
parts.append("\n".join(kept).strip())

parts.append("""

# ============================================================
# 第二部分：魅族专属规则
# （完整提取自 RS2.0.2daily，共 89 包 / 265 条）
# ============================================================
""")
# 去掉魅族段自己的文件头（保留正文）
mtxt = meizu_txt
idx = mtxt.find("# ---------- 界面与桌面 ----------")
parts.append((mtxt[idx:] if idx >= 0 else mtxt).strip())

parts.append("""

# ============================================================
# 第三部分：AsoulOpt 游戏规则（独立部分）
# （替换彗星原游戏规则；共 333 个游戏条目）
# ============================================================
""")
atxt = read(ASOUL)
aidx = atxt.find("# ---------- 游戏 ----------")
parts.append((atxt[aidx:] if aidx >= 0 else atxt).strip())

final = "\n".join(parts) + "\n"
with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(final)

rules = [l for l in final.splitlines() if "=" in l and not l.startswith("#")]
print(f"\n最终 applist.conf: {len(final.splitlines())} 行 / {len(rules)} 条规则")
print(f"  彗星段 + 魅族段(265) + AsoulOpt段(3330)")
