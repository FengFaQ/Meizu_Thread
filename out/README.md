# out — 构建产物归档

本目录存放**已构建好的可刷入模块包**，随仓库一起推送，方便直接取用。

## 文件

| 文件 | 说明 |
|---|---|
| `Meizu_Thread_1.0.zip` | 魅族线程模块 1.0，可直接用 Magisk / KernelSU 刷入 |

## 直接下载

```
https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main/out/Meizu_Thread_1.0.zip
```

## 说明

- 此 zip **由 `tools/build_zip.py` 自动生成并同步**，请勿手工修改。
- 每次重新构建都会覆盖本目录下的同名文件。
- 源代码与规则文件在仓库根目录；本目录仅为**产物归档**。

## 重新构建

```bash
# 1. 生成魅族规则
python tools/gen_meizu_rules.py
# 2. 生成 AsoulOpt 规则
python tools/gen_asoulopt_rules.py
# 3. 符号化彗星底座
python tools/symbolize_base.py
# 4. 组装 applist.conf
python tools/build_applist.py
# 5. 校验
python tools/verify.py
# 6. 打包（自动同步到 out/）
python tools/build_zip.py
```
