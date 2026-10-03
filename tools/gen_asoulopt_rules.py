# -*- coding: utf-8 -*-
"""
生成 AsoulOpt 游戏段（并入彗星 / 魅族线程模块）

设计决策（重要）：
  1. AsoulOpt 的匹配语义是「包名包含该片段即命中」（README.md:12-19）。
     彗星引擎（AkiAppOpt）的包名匹配走 fnmatch，支持 * ? []。
     用 `*片段*` 即可精确复现「子串包含」语义。

  2. 不为每个游戏展开全部线程名（那会产生 3330 条规则，臃肿且无必要）。
     改为按「游戏引擎族」归类：同一引擎的线程命名规律一致。
     每个条目只写：
        主线程族  -> hp-core
        渲染族    -> p-core
        进程兜底  -> p-core
     共 5 条/游戏。

  3. 线程名遵循内核 TASK_COMM_LEN-1 = 15 字符截断规则。
     Unity 引擎关键线程实测名（截断后）：
        UnityMain              (9)  -> 不截断
        UnityGfxDeviceW       (15)  -> 恰为 15
        UnityGfxDeviceWorker  (20)  -> 截断为 UnityGfxDeviceW
     RHIThread / GameThread / RenderThread 均在 15 以内。
"""
import io, re

ASOUL_README = r"C:\xiancheng\创作工作\02_游戏线程_Magisk_AsoulOpt\README.md"
OUT = r"C:\xiancheng\创作工作\03_魅族线程_Meizu_Thread\asoulopt_rules.conf"

# ---- 抽取条目 ----
raw = io.open(ASOUL_README, encoding="utf-8", errors="replace").read()
m = re.search(r"```(.*?)```", raw, re.S)
entries = sorted({l.strip() for l in m.group(1).splitlines()
                  if l.strip() and not l.strip().startswith("#")})

# ---- 线程规则模板（基于彗星 Game_8G3.txt 既有实践 + 15 字符截断） ----
# 主线程 / 引擎线程 -> 超大核
MAIN = [
    "UnityMain",
    "GameThread",
    "MainThread",
    "UE4Game",
    "NativeThread",
]
# 渲染 / 图形 -> 性能核
GFX = [
    "UnityGfxDeviceW",   # UnityGfxDeviceWorker 截断
    "RHIThread",
    "RenderThread",
    "TaskGraphNP*",
]

out = io.StringIO()
out.write("# ============================================================\n")
out.write("# AsoulOpt 游戏线程段（独立部分）\n")
out.write("# ============================================================\n")
out.write("# 来源：nakixii/Magisk_AsoulOpt 支持列表\n")
out.write(f"# 规模：{len(entries)} 个游戏条目\n")
out.write("#\n")
out.write("# 匹配语义：\n")
out.write("#   AsoulOpt 原为「包名包含该片段即命中」的子串匹配。\n")
out.write("#   彗星引擎包名走 fnmatch，支持 * ? []，故写作 *片段* 完全等价。\n")
out.write("#   例：com.Nekootan.kfkj.android 命中 *Nekootan.kfkj*\n")
out.write("#\n")
out.write("# 线程分配理念（沿用彗星 Game_8G3.txt）：\n")
out.write("#     主线程/引擎线程 -> hp-core  （大核，保帧率下限）\n")
out.write("#     渲染/图形线程   -> p-core   （性能核）\n")
out.write("#     其余线程/兜底   -> p-core\n")
out.write("#\n")
out.write("# 注：线程名遵循内核 TASK_COMM_LEN-1=15 字符截断，\n")
out.write("#     如 UnityGfxDeviceWorker -> UnityGfxDeviceW。\n")
out.write("# ============================================================\n")
out.write("\n# ---------- 游戏 ----------\n")

for e in entries:
    out.write(f"\n# {e}\n")
    for t in MAIN:
        out.write(f"*{e}*{{{t}}}=hp-core\n")
    for t in GFX:
        out.write(f"*{e}*{{{t}}}=p-core\n")
    out.write(f"*{e}*=p-core\n")

out.write("\n# ---------- 游戏END ----------\n")

txt = out.getvalue()
with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(txt)

rules = sum(1 for l in txt.splitlines() if "=" in l and not l.startswith("#"))
print(f"entries: {len(entries)}")
print(f"rules  : {rules}  ({rules/len(entries):.1f} per entry)")
