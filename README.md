# Komari-Theme-LuminaPlus

一直以来，比较支持这样一个观点：**如果有比较特殊的需求，并且自己具备相关能力，最好可以进行二次开发** 原因主要有几点：
1. 需考虑大方向设计维护。毕竟公用产品，但每个兄弟的审美、习惯和需求都有所不同，“众口难调”，自己喜欢的才是最好的。
2. 能力、精力有限。 我是后端开发，前端也仅是通过Vibe Coding完成。如果兄弟具备前端开发能力，最好是再开发。
3. 版本存在滞后性。 有问题或者好建议我会记录并后续版本中处理。但现实本职+生活影响，时间并非充裕。
产品最初的价值和目标，是希望兄弟们用得、看得、体验舒服。所以，无论是建议、功能优化、交互逻辑、设计思路，还是发现 Bug，都非常欢迎积极、开放地提交 Issue。

基于 [komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina) 的增强分支。感谢原作者 [stqfdyr](https://github.com/stqfdyr) 开源 Lumina 主题。

## 效果预览

<p align="center">
  <img src="docs/images/theme-preview.png" alt="Komari-Theme-LuminaPlus 综合预览" width="90%">
</p>

### 首页总览与节点卡片

首页总览新增文字评级，节点卡片同步优化流量额度、在线时长与布局密度；支持背景图、桌面视频与卡片透明度调节。

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-solid.png" alt="首页总览与大卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-solid-dark.png" alt="首页总览与大卡片夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-solid.png" alt="首页总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-solid-dark.png" alt="首页总览与小卡片夜间模式" width="70%">
</p>

### 透明背景

背景图、桌面视频与卡片透明度可在主题管理中配置，支持大卡片、小卡片和移动端布局。

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-glass.png" alt="透明背景首页总览与大卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-large-card-glass-dark.png" alt="透明背景首页总览与大卡片夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-glass.png" alt="透明背景首页总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/overview-compact-card-glass-dark.png" alt="透明背景首页总览与小卡片夜间模式" width="70%">
</p>

### 视频背景

桌面端可在主题管理中将背景类型切换为“视频”。主题内置一个静音 H.264 测试视频，默认站内路径为：

```text
/assets/LanternRivers_1080p15fps2Mbps3s.mp4
```

需要使用自己的视频时，推荐使用 MP4（H.264、无音轨、短循环）或浏览器兼容的 WebM。

#### VPS 上传自定义视频

Komari 常见安装目录下，主题视频所在位置为：

```text
/komari/data/theme/LuminaPlus/dist/assets
```

自定义视频的文件名不要与内置测试视频相同，否则主题可能仍会加载默认视频。下面以 `my-background.mp4` 为例。

1. 先把视频上传到 `/komari` 作为长期备份。以下命令在本地电脑执行，请将 `VPS_IP` 换成服务器地址：

   ```bash
   scp ./background.mp4 root@VPS_IP:/komari/my-background.mp4
   ```

2. 登录 VPS，将备份视频复制到主题资源目录：

   ```bash
   ssh root@VPS_IP
   cp -f /komari/my-background.mp4 /komari/data/theme/LuminaPlus/dist/assets/my-background.mp4
   chmod 644 /komari/data/theme/LuminaPlus/dist/assets/my-background.mp4
   ```

3. 在主题管理中启用自定义背景并选择“视频”，将视频地址改为：

   ```text
   /assets/my-background.mp4
   ```

4. 保存设置后刷新浏览器。

> 更新或重新安装主题后会恢复为默认视频。请务必在 `/komari` 保留一份自定义视频备份；更新后重新执行下面两条命令将视频拷回，再在主题管理中选择 `/assets/my-background.mp4` 即可恢复：

```bash
cp -f /komari/my-background.mp4 /komari/data/theme/LuminaPlus/dist/assets/my-background.mp4
chmod 644 /komari/data/theme/LuminaPlus/dist/assets/my-background.mp4
```

#### 自行构建主题

将文件以独立名称放入 `public/assets/`，例如 `public/assets/my-background.mp4`，然后在主题管理中填写 `/assets/my-background.mp4`。不要与内置测试视频同名。

执行 `npm run build` 时，Vite 会把 `public/assets/` 原样复制到 `dist/assets/`；执行 `npm run package` 时，打包脚本会把整个 `dist/` 收入主题 ZIP，因此内置视频和自行放入的资源都会随发布包打包。

视频仅在宽屏、非触摸主设备且用户未启用“减少动态效果”或省流量模式时加载；其他情况继续使用已配置的背景图。

### 实例详情

实例详情页优化 Ping 与负载图表展示，支持断点连线、手动刷新和更稳定的图表尺寸。

<p align="center">
  <img src="docs/images/v1.1.9/instance-ping.png" alt="实例详情 Ping 图表" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/instance-ping-dark.png" alt="实例详情 Ping 图表夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/instance-load.png" alt="实例详情负载图表" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/instance-load-dark.png" alt="实例详情负载图表夜间模式" width="70%">
</p>

### 移动端

移动端总览卡片采用更紧凑的信息展示，保留评级和关键指标。

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-solid.png" alt="移动端总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-solid-dark.png" alt="移动端总览与小卡片夜间模式" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-glass.png" alt="移动端透明背景总览与小卡片" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.9/mobile-overview-glass-dark.png" alt="移动端透明背景总览与小卡片夜间模式" width="70%">
</p>

### 资产统计

资产统计界面重做，整合入口、指标、明细排序与汇率信息。

<p align="center">
  <img src="docs/images/v1.1.7/asset-summary.png" alt="资产统计" width="70%">
</p>

### 主题管理

主题管理新增总览评级配置，并加入小卡片在线时间、资产统计等显示项开关。

<p align="center">
  <img src="docs/images/v1.1.7/settings-overview.png" alt="总览评级配置" width="70%">
</p>

<p align="center">
  <img src="docs/images/v1.1.7/settings-card-cost.png" alt="小卡片与资产统计配置" width="70%">
</p>

### 离线状态

离线节点保持清晰的状态提示，同时保留最近一次上报的关键指标。

<p align="center">
  <img src="docs/images/v1.1.7/offline-card.png" alt="离线节点状态" width="70%">
</p>

## 致谢

特别感谢 [stqfdyr/komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)。

特别感谢 [Montia37/komari-theme-purcarte](https://github.com/Montia37/komari-theme-purcarte) 提供视频背景的设计思路与内置测试视频素材。

也感谢 Komari 官方主题、Mochi 等主题项目为 Komari 生态提供的设计和实现思路。

## 参考

- [Komari](https://github.com/komari-monitor/komari)
- [komari-theme-Lumina](https://github.com/stqfdyr/komari-theme-Lumina)
- [komari-theme-purcarte](https://github.com/Montia37/komari-theme-purcarte)
- [Komari 主题开发文档](https://komari-document.pages.dev/)

## 本地 UI 审查

无需连接 Komari 后端也可以检查完整数据界面：

```bash
npm run dev -- --host 0.0.0.0
```

打开开发地址并追加 `?mock=1`。该模式只在 Vite 开发环境启用，会提供正常、高负载、临期、离线、多地区与多币种节点；生产构建不会包含这份测试数据。去掉查询参数即可恢复真实接口。

## Star History

<a href="https://www.star-history.com/?repos=shanyang242%2FKomari-Theme-LuminaPlus&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=shanyang242/Komari-Theme-LuminaPlus&type=timeline&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=shanyang242/Komari-Theme-LuminaPlus&type=timeline&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=shanyang242/Komari-Theme-LuminaPlus&type=timeline&legend=bottom-right" />
 </picture>
</a>
