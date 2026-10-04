# 魅族线程 (Meizu Thread) v3.0

为 **魅族 21（骁龙 8 Gen 3）** 整理的线程分配模块，分「用户线程」与「游戏线程」两部分。

> **v3.0 架构变更**：本版**不再自带线程引擎**。
> 用户线程交给 **Scene**（`com.omarea.vtools`），游戏线程交给**捆绑的 AsoulOpt**。
> 上一版（自带 AkiAppOpt 引擎）已打 tag `v2.0`，随时可取回。

## 组成

| 部分 | 执行者 | 配置文件 | 说明 |
|---|---|---|---|
| **用户线程** | **Scene** | `/data/user/0/com.omarea.vtools/files/threads.json` | 应用线程的核心分配，由 WebUI 可视化编辑 |
| **游戏线程** | **AsoulOpt**（捆绑） | `/data/adb/naki/asopt.conf` | 游戏清单 + `mode` / `rt`，由 WebUI 可视化编辑 |

## 安装

1. 通过 **KernelSU / KernelSU-Next / APatch**（或 Magisk）刷入 zip
2. **全自动安装，无任何询问**
3. 安装后在管理器中点击本模块的 **【WebUI】** 按钮

> ⚠️ 「用户线程」需要设备装有 **Scene**；未安装时安装脚本与 WebUI 都会提示
> （游戏线程不受影响）。

## WebUI

顶部两个页签：**用户线程** / **游戏线程**。

### 用户线程（→ Scene）

基于 Scene 的「自定义线程编辑器」改造，保留其全部编辑体验：
标签式线程名、核心选择器、拖拽排序、JSON 导入导出、文件选择器、
深色主题 / 模糊 / 背景图 / 透明度等。

**预置默认配置**：模块自带 `default_threads.json`，由本模块原
「彗星应用线程 + 魅族线程」（已去掉游戏段）转换而来，共 **179 条规则**。

- Scene 尚无配置时，WebUI **自动载入**这份默认（只进编辑器，点「保存」才写入 Scene）
- 任何时刻都可用「载入默认」重新载入

**数据模型**：采用 Scene 的 `cpuset` 模型（信息无损）

| 本项目来源 | → Scene 字段 |
|---|---|
| 渲染类线程（RenderThread / GLThread / …） | `heaviest_thread` + `heaviest_cores` |
| 主线程（线程名 = 包名或其后 15 位） | `main_thread` |
| 进程兜底（`包名=核心`） | `other` |
| 其余线程级规则（`binder:*`、`Thread-*`、`MediaCodec_*`…） | `comm`（核心 → 线程名前缀） |

> 之所以不用轻量的 `app_cpuset`（只有 `main`/`render`/`other` 三槽）：
> 实测 639 条源规则中有 **213 条**的核心与 `other` 不一致，
> 用 `app_cpuset` 会造成 **33% 真实信息损失**；`cpuset` 模型可做到 **0 损失**。
> 若仍想用轻量模型：`python tools/convert_to_scene.py --model app`

**符号 → 核心**（魅族21 / 2+3+2+1）：

| 符号 | 展开 |
|---|---|
| `e-core` | `0-1` |
| `p-core` | `2-4` |
| `hp-core` | `5-6` |
| `all-core` | `0-7` |

> 依据是底座原文的四条约束：`2-6→p-core,hp-core`、`5-6→hp-core`、
> `2-4→p-core`、`0-1→e-core` —— 在该映射下**全部精确成立**。

### 游戏线程（→ AsoulOpt）

- **全局**：`mode`（`0` 硬亲和 / `1` 软迁移 / `2` 硬迁移）、
  `rt`（`0` 调度器默认 / `1` 实时模式，**可能导致卡死**）
- **每游戏单独覆盖**：增 / 改 / 删，未列出的游戏使用全局值
- 自动列出**已安装且受支持**的游戏（按上游 README 关键词「包含即命中」匹配），
  并标注是「单独配置」还是「跟随全局」
- 生成的文件与上游 `customize.sh` 的格式**完全一致**（含同样的说明注释），
  可与官方 AsoulOpt 模块共用

## 关于捆绑的 AsoulOpt

- 来源：[nakixii/Magisk_AsoulOpt](https://github.com/nakixii/Magisk_AsoulOpt)，版本 `Kana`
- **逻辑一字未改**：`asoulopt/AsoulOpt` 与 `asoulopt/service.sh`
  与上游**逐字节一致**（`tools/test_webui.sh` 会机械校验这一点）
- 唯一改动：**安装位置**由 `/data/adb/modules/asoul_affinity_opt`
  移到本模块的 `asoulopt/` 子目录；`service.sh` 用 `${0%/*}` 定位自身，可直接工作
- 配置文件路径仍是上游定义的 `/data/adb/naki/asopt.conf`（未改）

## 文件说明

| 文件 | 说明 |
|---|---|
| `out/Meizu_Thread_3.0.zip` | **已构建好的可刷入包** |
| `webroot/` | WebUI 前端（`index.html` / `app.js` / `style.css`） |
| `webui.sh` | WebUI 后端：AsoulOpt 配置读写 + 环境检测 |
| `asoulopt/` | 捆绑的 AsoulOpt（二进制 + 上游 `service.sh`，均未改动） |
| `default_threads.json` | 预置的用户线程（179 条，Scene `cpuset` 格式） |
| `asoulopt_games.txt` | AsoulOpt 支持的游戏关键词（来自上游 README） |
| `service.sh` | 开机拉起捆绑的 AsoulOpt |
| `customize.sh` | 安装脚本 |
| `tools/` | 构建与转换工具（不随包分发） |

### 可复现工具

```sh
# 重新生成预置用户线程（读 applist.conf 的底座+魅族段，去游戏段）
python tools/convert_to_scene.py                 # 默认 cpuset（无损）
python tools/convert_to_scene.py --model app     # 轻量 app_cpuset

# 重新生成支持游戏关键词表
python tools/gen_asoulopt_games.py

# 后端自检（45 项，含与上游的逐字节比对）
sh tools/test_webui.sh

# 前端静态校验（DOM id / 页签配对 / 前后端子命令一致性）
node tools/check_frontend.js

# 打包
python tools/build_zip.py
```

> `applist.conf`、`base/`、`meizu_rules.conf`、`asoulopt_rules.conf`
> 仅作为转换来源保留在仓库，**不进入模块包**。

## 发布包下载

```
https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main/out/Meizu_Thread_3.0.zip
```

## 版本历史

- **3.0** —— 用户线程交给 Scene、游戏线程捆绑 AsoulOpt，移除自带引擎
- **2.0** —— 自带 AkiAppOpt 引擎 + 四页 WebUI（总览/引擎/自定义线程/备份）→ tag `v2.0`
- **1.0** —— 首个版本

## 致谢

- 线程编辑器 UI：[酷安@gyimo](https://www.coolapk.com/) 的「自定义线程编辑器 n1.5」
- 游戏线程：[nakixii/Magisk_AsoulOpt](https://github.com/nakixii/Magisk_AsoulOpt)
- 应用线程规则：[Sukimoka/Comet-Thread-Opt](https://github.com/Sukimoka/Comet-Thread-Opt)（彗星线程）
- 魅族规则来源：RS线程优化 (RS2.0.2daily)

详见 [致谢名单.md](致谢名单.md)。
