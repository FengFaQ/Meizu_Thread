# -*- coding: utf-8 -*-
"""
把本模块整合出的「应用线程」转换成 Scene（com.omarea.vtools）threads.json 格式。

来源：applist.conf 中的【彗星底座】+【魅族专属】两段
      —— 即彗星应用线程 + 魅族线程，**不含**【AsoulOpt 游戏规则】段
      （游戏线程由 AsoulOpt 本体负责，不在此转换）

两种目标模型（`--model` 选择）：

  cpuset（默认，**无损**）—— Scene 的细致模型，字段：
      heaviest_thread  负载最重线程名（分号分隔，命中多个取负载最高者）
      heaviest_cores   上述线程可用核心
      main_thread      主线程可用核心
      other            其它线程可用核心
      comm             { 核心: [线程名前缀, ...] }  ← 关键：能装下 binder:* / Thread-* 等
    本项目映射：
      渲染类线程      → heaviest_thread + heaviest_cores
      主线程          → main_thread
      进程兜底        → other
      其余线程级规则  → comm（按核心分组，名字转为前缀）
    实测：639 条规则全部可表达，0 损失。

  app（Scene 推荐给普通应用的轻量模型）—— app_cpuset，字段：
      main / render / other（各一个核心）+ webview / children（布尔）
    实测：只有 main/render/other 三个槽位，268 条线程级规则无处安放，
          其中 **213 条**核心与 other 不一致 → 真实信息损失 33%。
    仅在明确要「轻量优先」时使用。

符号 → 数字展开（魅族21 / 骁龙 8Gen3 / 2+3+2+1）：
    e-core = 0-1   p-core = 2-4   hp-core = 5-6   all-core = 0-7
选取依据（对 tools/symbolize_base.py 的原始数字反推）：
    底座原文 `2-6 → p-core,hp-core` ⇒ p∪hp 必须是 2-6
    底座原文 `5-6 → hp-core`        ⇒ hp 必须是 5-6
    底座原文 `2-4 → p-core`         ⇒ p 必须是 2-4
    底座原文 `0-1 → e-core`         ⇒ e 必须是 0-1
    四条在此映射下全部精确成立；唯一近似是原文 `7 → hp-core`（超大核 7 不在 5-6 内）。
    若要让超大核并入，把 HP_CORES 改成 "5-7"。
"""
import io, json, os, re, sys, collections

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPLIST = os.path.join(REPO, "applist.conf")
OUT = os.path.join(REPO, "default_threads.json")

E_CORES = "0-1"
P_CORES = "2-4"
HP_CORES = "5-6"
ALL_CORES = "0-7"

SYMBOL_MAP = {
    "e-core": E_CORES,
    "p-core": P_CORES,
    "hp-core": HP_CORES,
    "all-core": ALL_CORES,
}

# 渲染类线程名特征（小写子串匹配）→ 归入 heaviest_thread
RENDER_HINTS = [
    "renderthread", "glthread", "rithread", "rhithread", "vkthread",
    "gfx", "gpu", "egl", "vulkan", "surface", "draw", "graphics",
    "unitygfx", "hwui", "opengl",
]


def cpus_of(spec):
    out = set()
    for seg in str(spec).split(","):
        seg = seg.strip()
        if not seg:
            continue
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", seg)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if a > b:
                a, b = b, a
            out.update(range(a, b + 1))
        elif seg.isdigit():
            out.add(int(seg))
    return out


def compact(nums):
    if not nums:
        return ""
    xs = sorted(nums)
    parts, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x == prev + 1:
            prev = x
            continue
        parts.append(str(start) if start == prev else "%d-%d" % (start, prev))
        start = prev = x
    parts.append(str(start) if start == prev else "%d-%d" % (start, prev))
    return ",".join(parts)


def expand_core(core):
    total = set()
    for tok in str(core).split(","):
        tok = tok.strip()
        if not tok:
            continue
        if tok in SYMBOL_MAP:
            total |= cpus_of(SYMBOL_MAP[tok])
        elif re.fullmatch(r"[\d,\-\s]+", tok):
            total |= cpus_of(tok)
        else:
            return None
    return compact(total)


def parse_rule(line):
    if "=" not in line:
        return None
    lhs, rhs = line.split("=", 1)
    lhs, core = lhs.strip(), rhs.strip()
    core = re.split(r"\s+#", core)[0].strip()
    if not lhs or not core:
        return None
    thr = ""
    pkg = lhs
    m = re.match(r"^(.*?)\{(.*)\}$", lhs)
    if m:
        pkg, thr = m.group(1).strip(), m.group(2).strip()
    return pkg, thr, core


def is_main_thread(pkg, thr):
    if not thr:
        return False
    if thr == pkg:
        return True
    if len(pkg) > 15 and thr == pkg[-15:]:
        return True
    return False


def is_render_thread(thr):
    low = thr.lower()
    return any(h in low for h in RENDER_HINTS)


def to_prefix(thr):
    """把线程匹配式转成 comm 需要的『前缀』；无法表达的返回 None"""
    if not thr:
        return None
    if thr.startswith(("*", "?")):
        return None          # 前导通配无法当前缀
    p = thr.rstrip("*")
    return p or None


def build_cpuset(items):
    """items: [(thread, core)] → cpuset dict"""
    main_entries, render_entries, fallback, rest = [], [], None, []
    for thr, core in items:
        if thr == "":
            if fallback is None:
                fallback = core
        elif is_main_thread_ctx[0] and is_main_thread(is_main_thread_ctx[1], thr):
            main_entries.append((thr, core))
        elif is_render_thread(thr):
            render_entries.append((thr, core))
        else:
            rest.append((thr, core))

    cs = {}
    comm = collections.OrderedDict()

    def add_comm(core, name):
        c = expand_core(core)
        if not c:
            return
        p = to_prefix(name)
        if not p:
            stat["comm 无法表达(前导通配)"] += 1
            return
        comm.setdefault(c, [])
        if p not in comm[c]:
            comm[c].append(p)

    # 渲染类 → heaviest_thread / heaviest_cores（取出现最多的核心）
    if render_entries:
        cnt = collections.Counter(c for _, c in render_entries)
        top_core = cnt.most_common(1)[0][0]
        names, extra = [], []
        for thr, core in render_entries:
            if core == top_core and thr not in names:
                names.append(thr)
            else:
                extra.append((thr, core))
        if names:
            cs["heaviest_thread"] = ";".join(names)
            ec = expand_core(top_core)
            if ec:
                cs["heaviest_cores"] = ec
                stat["heaviest_thread(渲染类)"] += 1
        for thr, core in extra:
            add_comm(core, thr)

    # 主线程
    if main_entries:
        cnt = collections.Counter(c for _, c in main_entries)
        top_core = cnt.most_common(1)[0][0]
        ec = expand_core(top_core)
        if ec:
            cs["main_thread"] = ec
            stat["main_thread(主线程)"] += 1
        for thr, core in main_entries:
            if core != top_core:
                add_comm(core, thr)

    # 其余线程级规则 → comm
    for thr, core in rest:
        add_comm(core, thr)
        stat["comm(其余线程)"] += 1

    # 进程兜底 → other；没有就用剩余里最常见的核心
    if fallback is None:
        pool = rest + render_entries + main_entries
        if pool:
            fallback = collections.Counter(c for _, c in pool).most_common(1)[0][0]
            stat["other(取剩余最常见)"] += 1
    if fallback is not None:
        ec = expand_core(fallback)
        if ec:
            cs["other"] = ec
            stat["other(进程兜底)"] += 1

    if comm:
        cs["comm"] = comm
    return cs


def build_app_cpuset(items):
    main_core = render_core = other_core = None
    rest = []
    for thr, core in items:
        if thr == "":
            other_core = other_core or core
            stat["other"] += 1
        elif is_main_thread(is_main_thread_ctx[1], thr):
            main_core = main_core or core
            stat["main"] += 1
        elif is_render_thread(thr):
            render_core = render_core or core
            stat["render"] += 1
        else:
            rest.append((thr, core))
    if other_core is None and rest:
        other_core = collections.Counter(c for _, c in rest).most_common(1)[0][0]
    for thr, core in rest:
        lost[thr] += 1
        if other_core and expand_core(core) != expand_core(other_core):
            real_lost[thr] += 1
    ac = {}
    for key, src in (("main", main_core), ("render", render_core), ("other", other_core)):
        if src:
            v = expand_core(src)
            if v:
                ac[key] = v
    if ac:
        ac["webview"] = True
        ac["children"] = True
    return ac


stat = collections.Counter()
lost = collections.Counter()
real_lost = collections.Counter()
is_main_thread_ctx = ["", ""]


def main():
    model = "cpuset"
    if len(sys.argv) > 2 and sys.argv[1] == "--model":
        model = sys.argv[2]
    if model not in ("cpuset", "app"):
        sys.exit("--model 只能是 cpuset 或 app")

    if not os.path.isfile(APPLIST):
        sys.exit("缺少 %s" % APPLIST)

    section = ""
    rules = []
    for raw in io.open(APPLIST, encoding="utf-8"):
        line = raw.rstrip("\n").strip()
        if line.startswith("# ===== "):
            section = line
            continue
        if not line or line.startswith("#"):
            continue
        if "彗星底座" in section or "魅族专属" in section:
            r = parse_rule(line)
            if r:
                pkg = r[0].split(":")[0]        # 子进程归父包（Scene 有 children 开关）
                rules.append((pkg, r[1], r[2]))

    by_pkg = collections.OrderedDict()
    for pkg, thr, core in rules:
        by_pkg.setdefault(pkg, []).append((thr, core))

    out, unmapped, wildcard = [], [], []
    for pkg, items in by_pkg.items():
        if "*" in pkg or "?" in pkg:
            wildcard.append(pkg)
        is_main_thread_ctx[0], is_main_thread_ctx[1] = True, pkg
        if model == "cpuset":
            body = build_cpuset(items)
            if not body:
                unmapped.append(pkg)
                continue
            out.append({"friendly": pkg, "packages": [pkg], "cpuset": body})
        else:
            body = build_app_cpuset(items)
            if not body:
                unmapped.append(pkg)
                continue
            out.append({"friendly": pkg, "packages": [pkg], "app_cpuset": body})

    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(out, ensure_ascii=False, indent=2))
        f.write("\n")

    print("模型              : %s (%s)" % (model, "cpuset / 无损" if model == "cpuset" else "app_cpuset / 轻量"))
    print("输入规则          : %d 条（彗星底座+魅族专属，已去游戏段）" % len(rules))
    print("输出 Scene 规则   : %d 条 / %d 个包" % (len(out), len(by_pkg)))
    print()
    print("字段归类:")
    for k, v in sorted(stat.items()):
        print("   %-26s %d" % (k, v))
    if model == "app" and lost:
        print()
        print("⚠️  无槽位的线程级规则 %d 条，其中核心与 other 不一致（真实损失）: %d 条"
              % (sum(lost.values()), sum(real_lost.values())))
        for name, n in lost.most_common(10):
            print("   %-24s 共 %-4d 与 other 不同: %d" % (name, n, real_lost.get(name, 0)))
    if unmapped:
        print()
        print("⚠️  无法生成任何字段、已跳过的包 %d 个:" % len(unmapped))
        for p in unmapped[:10]:
            print("   %s" % p)
    if wildcard:
        print()
        print("⚠️  含通配符的包名 %d 个（Scene 是否支持未知，已原样保留）" % len(wildcard))
    print()
    print("已写入: %s" % OUT)


if __name__ == "__main__":
    main()
