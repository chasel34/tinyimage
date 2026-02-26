# AGENT.md

本文件面向后续参与 `TinyImage` 开发的工程师/Agent，说明当前技术架构、关键约束与修改入口，减少误改和重复探索成本。

## 1. 项目定位

- 项目类型：Raycast 扩展（仅 `macOS`）
- 核心能力：从 Finder 当前选中项读取图片，使用 `sharp` 进行压缩/格式转换
- 处理模式：先“预计算压缩结果（内存 buffer）”，后由用户触发单项或批量写入
- UI 形态：Raycast `Form` + `List` + `ActionPanel`

## 2. 命令入口与职责

- `src/compress-selected-images.tsx`
  - 主命令入口
  - 调用 `getSelectedFinderItems()`
  - 构建任务列表
  - 决定是进入“首次设置表单”还是直接进入任务列表
- `src/open-compression-settings.tsx`
  - 独立默认设置命令
  - 只负责读写默认设置（`LocalStorage`）

## 3. 目录结构（当前实现）

- `src/types.ts`
  - 全局共享类型（设置、任务项、状态、结果结构）
- `src/components/CompressionSettingsForm.tsx`
  - 默认设置 / 本次设置复用表单组件
- `src/components/CompressionTaskList.tsx`
  - 核心状态机与列表 UI（预计算、写入、批量操作、会话设置）
- `src/lib/settings.ts`
  - 默认设置值、输入归一化、LocalStorage 持久化
- `src/lib/finder.ts`
  - Finder 选中项转任务项
- `src/lib/compress.ts`
  - 单项预计算压缩（sharp 管线）
- `src/lib/write.ts`
  - 单项写入（临时文件 + rename + 覆盖/删除原图）
- `src/lib/pathing.ts`
  - 输出格式推导、路径命名、冲突自动改名
- `src/lib/format.ts`
  - 字节/百分比格式化、错误映射、状态文案
- `src/lib/concurrency.ts`
  - 受限并发执行器
- `src/lib/sharp-loader.ts`
  - `sharp` 运行时加载（优先 `assets/vendor-sharp`）
- `scripts/vendor-sharp-runtime.cjs`
  - 将 `sharp` 运行时依赖复制到 `assets/vendor-sharp`

## 4. 核心数据模型（必须先读）

关键类型在 `src/types.ts`：

- `CompressionSettingsV1`
  - 压缩设置结构（包含 `schemaVersion`）
- `ImageTaskItem`
  - 列表项的完整状态对象
- `ComputeStatus`
  - `unsupported | pending | computing | ready | compute-failed`
- `WriteStatus`
  - `idle | writing | written | write-failed`
- `ComputedBuffer`
  - 预计算结果（内存 `Buffer`、输出路径计划、大小等）

维护原则：

- 不要把“预计算状态”和“写入状态”合并成单一枚举，会让状态转换复杂且容易回归。
- 新增字段优先加在 `ImageTaskItem`，并保持重置逻辑（`resetTaskForNewRevision`）同步更新。

## 5. 主流程（运行时数据流）

### 5.1 主命令启动

1. `compress-selected-images.tsx` 并行读取：
   - Finder 选中项
   - 默认设置（`LocalStorage`）
2. 无选中项或无支持格式时：
   - `showToast(Failure)`
   - 渲染 fatal empty view
3. 有支持项时：
   - 无默认设置 => 进入首次设置表单
   - 有默认设置 => 进入 `CompressionTaskList`

### 5.2 列表页会话（`CompressionTaskList`）

- 初始化：
  - `tasks`（任务项数组）
  - `sessionSettings`（本次设置）
  - `settingsRevision`（关键并发防抖字段）
- `useEffect([settingsRevision])` 自动触发预计算
- 预计算完成后，任务项进入 `ready` 或 `compute-failed`
- 用户再触发：
  - 单项写入
  - 批量写入

### 5.3 本次设置修改

- 通过 `ActionPanel` 打开 `CompressionSettingsForm`
- 提交后调用 `resetSessionWithSettings()`
- 行为：
  - `settingsRevision + 1`
  - 清空预计算 buffer / 结果
  - 所有支持项重置为 `pending`
  - 自动重新开始预计算

## 6. 并发与状态一致性（非常重要）

当前固定并发数定义在 `src/lib/settings.ts`：

- `FIXED_CONCURRENCY = 2`

列表页使用的关键技术手段：

- `tasksRef` / `settingsRef` / `revisionRef`
  - 避免异步闭包拿到旧状态
- `settingsRevision`
  - 防止“旧设置版本”的预计算结果回写到新状态

修改时注意：

- 任何异步任务回写 `tasks` 前，都应检查 revision 是否仍匹配。
- 写入期间提交“本次设置”会被阻止（当前设计），不要轻易移除这个保护。

## 7. 压缩管线（`sharp`）

实现位置：`src/lib/compress.ts`

单项预计算流程：

1. `loadSharp()` 动态加载 `sharp`
2. 校验输入扩展名与输出格式
3. `stat()` 获取原始大小
4. `sharp(...).metadata()` 获取元信息（用于透明通道判断）
5. `rotate()` 自动按 EXIF 方向旋正
6. 透明图转 JPEG 时 `flatten({ background: "#ffffff" })`
7. 根据设置应用编码参数：
   - `jpeg({ quality })`
   - `webp({ quality })`
   - `avif({ quality })`
   - `png({ compressionLevel })`
8. `keepMetadata = true` 时 `withMetadata()`
9. `toBuffer()` 得到内存结果
10. 调用 `resolveOutputPathPlan()` 生成展示用输出路径计划

限制（当前设计）：

- 不做 resize
- 不生成预览文件（只做内存预计算）
- 支持格式仅 `jpg/jpeg/png/webp/avif`

## 8. `sharp` 运行时加载与 vendoring（必须理解）

Raycast 会把命令编译成单文件 JS，但 `sharp` 依赖平台二进制，直接静态 `import sharp` 在 Raycast 运行时可能报：

- `Could not load the "sharp" module using the darwin-arm64 runtime`

当前解决方案：

- 构建前通过 `scripts/vendor-sharp-runtime.cjs` 把运行时依赖复制到 `assets/vendor-sharp`
- 运行时由 `src/lib/sharp-loader.ts` 优先从 `environment.assetsPath/vendor-sharp/...` 加载 `sharp`
- 本地开发环境下失败时再 fallback 到当前项目 `node_modules`

不要做的事情：

- 不要把 `src/lib/compress.ts` 改回顶层静态 `import sharp from "sharp"`（会回归运行时问题）
- 不要删除 `assets/vendor-sharp` 或 `vendor-sharp` 脚本链路，除非同时替换为另一种可验证方案

相关脚本（`package.json`）：

- `postinstall`: 自动 vendoring
- `dev`: 先 vendoring 再 `ray develop`
- `build`: 先 vendoring 再 `ray build`

## 9. 输出路径与写入语义（关键业务规则）

路径规则实现位置：`src/lib/pathing.ts`

### 9.1 生成新图（`generate-new`）

- 同目录
- 基名追加 `.tiny`
- 扩展名取决于格式模式（保持原格式 or 转换后格式）
- 冲突自动改名：`-1`, `-2`, ...

示例：

- `a.png -> a.tiny.png`
- `a.png -> a.tiny.webp`
- 若冲突：`a.tiny-1.webp`

### 9.2 覆盖原图（`overwrite-original`）

- 保持原格式：写回同路径
- 转换格式：先写目标扩展名文件，成功后删除原文件（“转换并替换”）
- 若目标扩展名路径冲突：自动改名后再删除原文件（例如 `a-1.webp`）

### 9.3 写入安全策略（`src/lib/write.ts`）

- 总是先写同目录临时文件
- 成功后 `rename` 到目标路径
- 覆盖+转换删除原图失败时：
  - 返回失败状态
  - 保留已写出的新文件路径供用户处理
  - 不做自动回滚

## 10. UI / 交互约束（请保持一致）

当前交互设计（已定）：

- 列表顺序保持 Finder 选中顺序，不按状态重排
- 列表自动开始预计算
- 批量写入必须等待“全部预计算结束”
- `覆盖原图 + 批量写入` 需要 `confirmAlert`
- 单项写入不确认
- 列表页“修改本次设置”通过 `ActionPanel` 打开 `Form`

Raycast API 限制：

- `Action` 无真实 `disabled` 状态
- 当前实现用“占位动作 + Toast 提示”模拟禁用

如果改这里，请确认不破坏用户的发现性和 Raycast 原生交互体验。

## 11. 默认值与持久化（变更时要同步文档/类型）

默认值定义在 `src/lib/settings.ts` 的 `createDefaultCompressionSettings()`：

- `outputMode = generate-new`
- `formatMode = keep-original`
- `targetFormat = webp`
- `quality = 80`
- `pngCompressionLevel = 6`
- `keepMetadata = false`

存储位置：

- Raycast `LocalStorage`
- key: `tinyimage.default-settings.v1`

升级设置结构时建议：

- 增加 `schemaVersion`
- 保持 `normalizeCompressionSettings()` 兼容旧数据
- 不要直接假设 `LocalStorage` 数据可信

## 12. 常见改动入口（按需求定位文件）

### 新增一个设置项（例如 resize）

需要同时修改：

- `src/types.ts`（设置类型）
- `src/lib/settings.ts`（默认值 + normalize）
- `src/components/CompressionSettingsForm.tsx`（表单字段）
- `src/lib/compress.ts`（实际压缩逻辑）
- `README.md` / 本文件（如果行为对用户可见）

### 新增支持格式

需要同时修改：

- `src/lib/pathing.ts`
  - `SUPPORTED_INPUT_EXTENSIONS`
  - 格式推导映射
  - 输出扩展名映射
- `src/lib/compress.ts`（编码参数分支）
- `src/compress-selected-images.tsx` / `README.md`（支持格式说明文案）
- 错误映射（如有必要）

### 调整状态展示或进度规则

主要修改：

- `src/components/CompressionTaskList.tsx`
- `src/lib/format.ts`

注意保持：

- `settingsRevision` 并发防护逻辑
- 写入状态与预计算状态分离

### 调整写入路径/命名规则

主要修改：

- `src/lib/pathing.ts`
- `src/lib/write.ts`

需要回归验证：

- 冲突改名
- 覆盖原图 + 转换格式
- 删除原图失败分支

## 13. 手工回归清单（提交前建议）

- `npm run lint`
- `npm run build`
- `npm run dev` 后在 Raycast 手工验证以下场景：
  - Finder 未选中任何项
  - 混合选中支持/不支持格式
  - 首次设置流程
  - 自动预计算完成后批量写入
  - 单项写入
  - 覆盖原图批量确认弹窗
  - 生成新图命名冲突自动改名
  - 覆盖原图 + 转换格式（原图删除）
  - 修改本次设置后自动重算

## 14. 当前已知限制 / 设计取舍

- 预计算结果保存在内存，不做内存上限控制（大量/超大图片可能占用较高）
- 不提供预览文件，仅展示预计算结果数值
- 不支持动图 / HEIC / TIFF
- 不做自动化测试，当前以 `lint/build + 手工回归` 为主

## 15. 维护建议（给后续 Agent）

- 修改核心行为前先读：`src/types.ts`、`src/components/CompressionTaskList.tsx`、`src/lib/pathing.ts`
- 遇到 `sharp` 加载报错先检查：
  - `assets/vendor-sharp` 是否存在
  - `npm run vendor-sharp` 是否执行成功
  - 是否误改回静态 `import sharp`
- 新增功能时优先保持当前交互约束（Raycast 风格、批处理语义、覆盖安全性）

