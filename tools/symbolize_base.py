# -*- coding: utf-8 -*-
"""
将彗星底座 (App_8G3) 的写死核心编号转换为【保留层级】的符号表达式。

问题：8G3 的编号带有作者刻意的层级区分 --
    2-6  = 中核+大核  -> 前台渲染/主力线程（69 个 RenderThread 都用它）
    5-6  = 仅大核     -> 后台/次要线程（83 个进程兜底用它）
若把两者都映射成 p-core，会丢失这一区分。

解决：用符号表达式表达层级差异。Comet 引擎支持逗号并集，
      且允许 "p-core,hp-core" 这类组合。

映射（面向 2+3+2+1 的 8G3 语义，由引擎在运行时按实测拓扑展开）：
    0-1,5 -> e-core          轻负载
    0-1   -> e-core
    2-4   -> p-core          中核
    2-6   -> p-core,hp-core  中核+大核（前台主力，铺得更宽）
    5-6   -> hp-core         仅大核（后台次要）
    7     -> hp-core         超大核
    2-7   -> e-core,p-core,hp-core  （2 到 7 全覆盖，保守等价）
    5-7   -> p-core,hp-core
    2-4,7 -> p-core,hp-core
"""
import io, os

REPO = r"C:\xiancheng\创作工作\03_魅族线程_Meizu_Thread"
BASE = os.path.join(REPO, "base")

MAP = {
    "0-1,5":  "e-core",
    "0-1":    "e-core",
    "2-4":    "p-core",
    "2-6":    "p-core,hp-core",
    "5-6":    "hp-core",
    "7":      "hp-core",
    "2-7":    "e-core,p-core,hp-core",
    "5-7":    "p-core,hp-core",
    "2-4,7":  "p-core,hp-core",
}

for fn in ("App_8G3.txt",):
    p = os.path.join(BASE, fn)
    out, n, unmapped = [], 0, []
    for l in io.open(p, encoding="utf-8"):
        s = l.rstrip("\n")
        st = s.strip()
        if st and not st.startswith("#") and "=" in st:
            lhs, rhs = st.rsplit("=", 1)
            rhs = rhs.strip()
            if rhs in MAP:
                s = lhs.rstrip() + "=" + MAP[rhs]
                n += 1
            else:
                unmapped.append(rhs)
        out.append(s)
    io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
    print(f"{fn}: 转换 {n} 条 -> 符号表达式")
    if unmapped:
        import collections
        print("  未映射的值:", dict(collections.Counter(unmapped)))
