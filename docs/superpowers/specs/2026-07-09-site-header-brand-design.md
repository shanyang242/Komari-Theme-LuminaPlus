# 设计文档：LuminaPlus 顶部品牌 Header

- 日期：2026-07-09
- 状态：已批准，待实现
- 目标：在页面顶部新增一条 sticky 标题栏，展示站点 **Logo + 名称**，滚动时背景毛玻璃虚化；可在主题管理页开关与自定义。

## 背景与动机

LuminaPlus 主题当前顶部没有独立的品牌栏，首页内容（节点概览 + 网格）直接从顶部开始，右上角仅有一个悬浮控件球（切换视图 / 主题 / 后台）。站长缺少一个展示自己站点名称与 Logo 的位置。参考 `komari-theme-emerald` 的 `Header.vue`，它用一条 sticky 标题栏承载 `favicon + sitename`。

## 数据来源（已核实 Komari 后端源码）

- **Logo**：Komari 后台上传的图标即站点 favicon。后端将其存于 `./data/favicon.ico`，通过固定端点 **`/favicon.ico`** 对外提供（见 `web/public/public.go` 的 favicon 优先策略）。因此主题默认直接引用 `/favicon.ico` 即可拿到站长上传的 Logo。
- **站点名**：`/api/public` 返回的 `sitename` 字段，前端已有 `usePublicConfig()` 提供（`config.sitename`）。
- `/api/public` **没有**单独的 logo 字段——emerald 也是复用 favicon，本方案一致。
- **自定义 Logo URL**（可选）：站长可在主题管理页填任意图片地址；留空时回退 `/favicon.ico`；若 favicon 也加载失败，回退显示站点名首字符（与 emerald 的 `AvatarFallback` 一致）。

## 架构与组件

### 新增组件 `src/components/shell/SiteHeader.tsx`
- 纯展示组件。读取：
  - `usePublicConfig()` → `sitename`（回退 `"Komari"`，与后端默认一致）。
  - `useThemeSettings()` → `showSiteHeader`（开关）、`siteHeaderLogo`（自定义 Logo URL）。
- 结构：
  - 左侧：Logo `<img>`（`src` = 自定义 URL 或 `/favicon.ico`；`onError` 回退首字母占位块）+ 站点名文本，整体包在 `<Link to="/">`，点击回首页。
  - 右侧：为右上角悬浮球留出安全间距，暂不放按钮（避免与悬浮球功能重复）。
- 交互：sticky 固定顶部；滚动监听切换毛玻璃背景（轻量 scroll 监听，阈值约 4–8px）。
- 渲染条件：`showSiteHeader === true` 时才渲染；主题管理视图（`view=theme-manage`）不渲染（与 `FloatingControls` 的判断一致）。

### 新增样式 `src/styles/site-header.css`
- 复用现有 CSS 变量（`--surface`、`--text-primary`、`--text-secondary` 等），风格与卡片一致。
- 通过 `@import` 并入 `src/styles/index.css`。
- 关键类：sticky 容器、滚动态毛玻璃（`backdrop-blur` + 半透明背景 + 底部分隔线）、Logo 尺寸（约 32px，圆角方形）、首字母占位块。

### 挂载点 `src/components/shell/AppShell.tsx`
- 在 `<main>` 之前渲染 `<SiteHeader />`。
- 悬浮球位置与现有逻辑保持不变；Header 右侧留白避开悬浮球，避免右上角重叠。

## 主题设置（融入现有配置系统，改动最小）

### `src/utils/themeSettings.ts`
在三处各加两个字段（遵循现有 `enabledUnlessFalse` / `normalizePlainText` 归一化风格）：
- `showSiteHeader: boolean`，默认 `true`（`enabledUnlessFalse`）。
- `siteHeaderLogo: string`，默认 `""`（`normalizePlainText` 或 `normalizeBackgroundUrl` 复用其一做去空白/校验）。

涉及：`ResolvedThemeSettings` 接口、`DEFAULT_THEME_SETTINGS`、`normalizeThemeSettings`。

### `src/pages/ThemeManage.tsx`
- `pickManagedThemeSettings` 增加 `showSiteHeader`、`siteHeaderLogo` 两项（草稿类型与内容签名自动派生）。
- 新增一个「顶部标题栏」`InstancePanel` 区块，复用背景图那套 UI 模式：
  - 「显示标题栏」开关 → `patch("showSiteHeader", ...)`。
  - 「自定义 Logo URL」输入框 → `patch("siteHeaderLogo", ...)`，占位提示「留空则使用后台上传的站点图标」。

## 错误处理

- Logo（favicon 或自定义 URL）加载失败 → `onError` 切到站点名首字母占位块，不留破图。
- `sitename` 为空 → 回退 `"Komari"`。
- config 未就绪（`useThemeSettings().isReady === false`）→ Header 不闪烁：可先不渲染或渲染占位，待 ready 后稳定呈现。

## 测试

- 单元测试：为 `normalizeThemeSettings` 的两个新字段补测（默认值、非法值回退），跟随现有 `src/utils/__tests__/` 中 themeSettings 相关测试风格。
- 手动验证清单：
  - 开关：关闭后 Header 不出现；开启后出现。
  - 自定义 URL：填写后 Logo 切换为该图；留空时用 `/favicon.ico`。
  - 回退：favicon 不存在时显示首字母占位。
  - 滚动：向下滚动出现毛玻璃背景。
  - 移动端：窄屏不与悬浮球重叠。
  - 点击：点 Logo/站点名从详情页回到首页。

## 明确不做（YAGNI）

- 不做浅色 / 深色分开的双 Logo（背景图那种 `A|B` 写法）——如后续需要再加。
- 不在 Header 右侧重复放主题 / 后台按钮——悬浮球已提供。
- 不新增站点描述副标题（保持标题栏简洁；如需可后续扩展）。
