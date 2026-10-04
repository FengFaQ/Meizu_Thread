# 更新日志

## 3.0

**架构变更：不再自带线程引擎。**
「用户线程」交给 **Scene**，游戏线程交给 **捆绑的 AsoulOpt**。

### 用户线程（Scene）
- WebUI 基于 **Scene 的「自定义线程编辑器」**（酷安@gyimo，n1.5）改造，完整保留其编辑体验
  （标签式线程名、核心选择器、拖拽排序、JSON 导入导出、文件选择器、主题/模糊/背景图…）
- 编辑对象：`/data/user/0/com.omarea.vtools/files/threads.json`，**由 Scene 读取生效**
- **预置默认配置**（`default_threads.json`）：由本模块原「彗星应用线程 + 魅族线程」
  （去掉游戏段，639 条）转换而来，共 **179 条规则 / 179 个包**
  - Scene 首次没有配置时，WebUI 会**自动载入**这份默认（只进编辑器，点保存才写入 Scene）
  - 也可随时用「载入默认」重新载入
- 转换采用 Scene 的 **`cpuset` 模型**（**无损**）：
  - 渲染类线程 → `heaviest_thread` + `heaviest_cores`
  - 主线程 → `main_thread`
  - 进程兜底 → `other`
  - 其余线程级规则（`binder:*`、`Thread-*`、`MediaCodec_*` 等）→ **`comm`**（核心 → 线程名前缀）
  - 对比：若用轻量的 `app_cpuset`（只有 main/render/other 三槽），
    639 条里有 **213 条**核心与 other 不一致 → **33% 真实信息损失**；
    用 `cpuset` 模型可 **0 损失**（仅 13 条前导通配如 `*Thread` 无法用「前缀」表达）
- 符号名按魅族21（8Gen3 / 2+3+2+1）展开为具体核心：
  `e-core=0-1`、`p-core=2-4`、`hp-core=5-6`、`all-core=0-7`
  （依据：底座原文 `2-6→p-core,hp-core`、`5-6→hp-core`、`2-4→p-core`、`0-1→e-core`
  四条在此映射下**全部精确成立**）
- **移除了游戏线程（cpuset 的「游戏」用法）的钉核编辑** —— 游戏不再由此处绑核

### 游戏线程（AsoulOpt，捆绑）
- 捆绑上游 **nakixii/Magisk_AsoulOpt**（版本 Kana），
  **其逻辑一字未改**：`asoulopt/AsoulOpt` 二进制与 `asoulopt/service.sh`
  与上游**逐字节一致**（已在自检中机械校验）
- 仅把它的**安装位置**由 `/data/adb/modules/asoul_affinity_opt` 移到本模块的
  `asoulopt/` 子目录；配置文件路径仍为上游定义的 `/data/adb/naki/asopt.conf`
- WebUI「游戏线程」页保留对 **AsoulOpt 配置的可视化编辑**：
  - 全局 `mode`（0 硬亲和 / 1 软迁移 / 2 硬迁移）与 `rt`（0 调度器默认 / 1 实时）
  - **每游戏单独覆盖**（增 / 改 / 删），配置文件格式与上游**完全一致**（含同样的说明注释）
  - 自动列出**已安装且受支持**的游戏（按上游 README 关键词匹配），并标注是「单独」还是「跟随全局」
- `customize.sh` 会在缺失时生成与上游格式一致的默认 `asopt.conf`（已存在则绝不覆盖）

### 撤销 / 移除
- 移除自带引擎相关文件：`bin/`、`AppOpt`、`applist.conf`(不入包)、`confige.txt`、
  `custom_rules.tsv`、`action.sh`、`check.sh`
- 保留规则源文件（`base/`、`meizu_rules.conf`、`asoulopt_rules.conf`）与 `applist.conf`
  作为 `default_threads.json` 的**转换来源**，不入包
- v2.0（引擎版）已打 tag **`v2.0`**，随时可回到该版本

## 2.0

**本次重点：真正可用的图形化 WebUI。**
（1.0 只有模块「操作」按钮触发的终端脚本，并没有 WebUI。）

### 新增：WebUI（KernelSU / KernelSU-Next / APatch）
- 模块内置 `webroot/`，安装后管理器中出现 **【WebUI】按钮**
- 三个标签页：**总览 / 自定义线程 / 备份·导入**
- **总览**：规则统计、**实测拓扑展开**（把 `e-core` / `p-core` / `hp-core`
  还原成设备上真实的 CPU 号）、三个开关、应用配置、在线更新规则
- 后端为 `webui.sh`：纯 POSIX sh + toybox/busybox，**不依赖 jq / python**
- 前端兼容 KernelSU 注入接口的两种形态（回调名式 / Promise 式）

### 新增：上游配置项全部纳入 WebUI
- **AkiAppOpt 引擎参数**（二进制 `getopt` 串为 `c:s:b:hv`）：
  - `-s <秒>` **扫描间隔**（上游默认 2，范围 1–3600）——此前模块**完全没传这个参数**，一直在用默认值，现可调
  - `-b <名字>` **cpuset 目录名**（上游默认 `AkiAppOpt`）
  - 两者写入 `confige.txt`，由 `service.sh` 启动时读取；WebUI 保存后会**重启引擎**立即生效
- **AsoulOpt 运行模式**（上游 nakixii 模块，`/data/adb/naki/asopt.conf`）：
  - `mode`：`0` 硬亲和 / `1` 软迁移 / `2` 硬迁移
  - `rt`：`0` 调度器默认 / `1` 实时模式
  - **每游戏单独覆盖**：`<包名> <mode> <rt>`，可增删改
  - 生成的配置文件与上游 `customize.sh` 格式**完全一致**（含同样的说明注释），
    可直接与官方 AsoulOpt 模块共用；未安装时页面会明确提示
- WebUI 由三页扩为四页：**总览 / 引擎 / 自定义线程 / 备份**

### 新增：自定义线程
- 可为**任意应用**（已适配或未适配）自由增删改绑核规则
- **支持覆盖内置规则**：自定义规则排在最前，并剔除同选择器的内置行，
  保证每个选择器在全文件中唯一 → 覆盖语义明确，不依赖引擎去重方向
- 支持进程级兜底（线程名留空）与精确线程名
- 内置「填入主线程名（后 15 位）」助手，规避内核 `TASK_COMM_LEN-1` 截断
- 校验：非法核心名、超过 15 字符的线程名会被明确拒绝

### 新增：备份 / 导入
- 一键导出到 `/sdcard/Download/Meizu_Thread_backup_<时间>.txt`
  （含开关状态 + 全部自定义规则），多候选目录自动回退
- 粘贴备份内容即可导入恢复
- 升级安装**自动保留**已有自定义规则（`customize.sh` 新增 `restore_custom_rules`）

### 变更
- `action.sh` 改为**终端回退入口**，与 WebUI 共用同一套生成逻辑
  （1.0 的 action.sh 会忽略自定义规则、每次联网下载并直接覆盖 `applist.conf`）
- 规则改为**本地优先**：无网也能应用配置；在线更新改为在 WebUI 中手动触发
- 「更新日志」的时间基准改为独立的 `rules_time`（仅在线更新时刷新，不再随每次应用变化）
- 版本号 2.0 / versionCode 200

### 修复
- **底座与魅族段的包级冲突**：`com.meizu.flyme.launcher` 同时存在于两段规则中，
  现按「魅族段整体覆盖底座」处理：魅族段启用时，底座中同包规则整体不参与生成。
  （生成结果已与 1.0 发布包逐字节回归比对，完全一致）

## 1.0

首个版本，面向 **魅族 21（骁龙 8 Gen 3）**。

### 模块底座
- 基于 **Comet Thread Opt（彗星线程）** 构建
- 底座规则全部改为**符号核心名**（`e-core` / `p-core` / `hp-core`），
  由引擎按设备实测 CPU 拓扑在运行时展开，不再写死核心编号

### 魅族专属规则
- 从 **RS线程优化 (RS2.0.2daily)** 完整提取全部 `com.meizu.*` / `com.flyme.*` 规则
- 共 **89 个包 / 265 条规则**，无遗漏
- 原文件使用写死的 `4+3+1` 拓扑编号，已重映射为符号名：
  - `0-1` → `e-core`（binder / 后台）
  - `2-5` → `p-core`（渲染 / 前台主线程）
  - `4-5` → `e-core,p-core`（进程级兜底）
- **兜底为何不映射为 `hp-core`**：RS 的 `4-5` 是 4+3+1 拓扑下的 **2 个**性能核；
  而魅族21（2+3+2+1）的 `hp-core` 只展开为**单个**超大核（核心 7）。
  若把 89 个包的兜底线程全部绑到 1 个核上会造成争抢，
  故与彗星底座实践（`App_common` 中 85 处使用 `e-core,p-core`）保持一致。
- 修正 `com.meizu.flyme.launcher` 主线程名为 `.flyme.launcher`
  （内核 `TASK_COMM_LEN-1 = 15` 字符截断）

### AsoulOpt 游戏规则（独立部分）
- 引入 **Magisk_AsoulOpt** 支持列表，共 **333 款游戏**
- 替换彗星原有游戏规则
- 保持 AsoulOpt「包名包含即命中」的子串匹配语义（展开为 `*片段*`）

### WebUI
- 新增 **AsoulOpt 独立配置栏**，可单独开关
- 配置项：`meizu`（魅族专属）/ `asoul`（AsoulOpt）/ `8G3`（底座档位）
- 修改 `confige.txt` 后点击模块操作按钮即可按新配置重新生成规则
- 支持从仓库按需拉取各部分配置

### 安装流程（已按魅族场景简化）
- **删除全部交互询问，改为全自动安装、默认直接启用**
  - 移除彗星原有的「按音量键选择 App / App+Game 模式」
    —— 游戏线程已由 AsoulOpt 承担，再询问是否使用游戏线程已无意义
  - 移除「是否启用魅族专属规则」询问
    —— 魅族专属规则是本模块的核心，默认启用
  - 移除「是否启用 AsoulOpt」询问 —— 默认启用
- SoC 档位（8G3 / 通用）由 `ro.soc.model` 等属性**自动判定**，不询问
- 修正升级安装的行为：原先直接整体覆盖 `confige.txt`，
  会导致用户开关设置被重置；现改为**仅继承用户开关状态**，
  档位与时间用本次探测值覆盖
- 如需调整开关，安装后在 WebUI（`confige.txt`）中修改
