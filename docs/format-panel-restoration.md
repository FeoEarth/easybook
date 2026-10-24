# 格式面板 UI 退化修复

## 历史定位

- PR #12 合并：`543e502ed8c4ca1c39e521632312adb2de512b42`，完成紧凑格式控件和小屏布局优化。
- 最近未发生网格退化的发布提交：`39f56e13b43e6d1f6da020c086f1fdd4f0c0e41a`（build57）。
- 首次引入退化：`0f8dcc8e7c34dfb392cb677c9e5e46c77107881a`，PR #14 于 `1e23a32ea54cd79d055c687975250c2a6aae53a6` 合并（build58），build59 继续包含。
- 当前修复基线：`15962c3b836fb801986e314351b5cdaa6ae555d9`。

读取以上版本实际文件后，PR #12、build57、build59 的整个 `app/src/main/assets/index.html` 均为同一 Git blob：`6ceec0879cf9e1416af0354e5c52a78aba460399`。因此不能把 PR #12 的整个变更回退或再次覆盖到 main：成熟格式布局和业务处理器一直保留着。

退化发生在两处 Android 展示代码：

1. `native-glass/menu.js` 将 `formatDialog` 加入通用原生菜单枚举，隐藏原面板，并把所有可见 `button/summary` 扁平化成 items。
2. `NativeGlassMenu.populatePanel()` 的 `kind=format` 分支以 `i%3` 强制生成三列等宽按钮；340dp 宽的滚动容器取代原布局，语义标签代替原图标和字形。

QWEA0 shader、GlassMaterial、GlassSurface 的光学更新属于材质变更，不是网格的起因，继续保留。原 `index.html` 的 Tiptap 命令、颜色操作、列表缩进、选区书签、关闭方式和底部工具栏处理器均未改变。通用原生菜单曾通过 token 在关闭动画后触发 DOM 按钮；本次仅让格式面板退出该展示/转发路径，其他菜单继续使用原路径。

## 精确恢复

- `formatDialog` 不再被隐藏或序列化成通用菜单，删除 Java 三列分支，桥接也不再接受 `kind=format`。
- 直接显示一直存在的成熟 DOM 面板：五种段落样式横向条；粗体/斜体/下划线/删除线与高亮分段控件；列表、待办、缩进、引用分组；高亮/字体颜色子面板；“更多”中的插入、链接、扩展及撤销/重做。
- 既有最小44px控件、360px小屏换行规则、横向滚动、面板高度上限、安全区域、键盘位置、原动画与编辑选区行为继续由原代码负责。
- `index.html`、底部 `formatbar/formatTrack` 及编辑器 bundle 零修改；不修改 Worker、模型、数据库或同步。

## 材质与布局分离

新增 `FormatGlassFrame` 只接收面板矩形、可见性及主题。它复用现有 QWEA0 Shader、GlassSurface 和 GlassBackdrop，在原面板外缘12dp范围内绘制；中心区域完全挖空，不过滤文字、不创建内部按钮、不抢焦点、不拦截触摸。圆角32dp匹配历史 DOM 外壳。

原面板内部保留已有可读性填充、边框、阴影和选中状态，没有给每个按钮叠加新玻璃，也没有提高全局染色或模糊。DOM ResizeObserver、viewport/transition 事件同步材质边界，不截图、不回读像素、不运行轮询捕获。原面板外壳的 WebView 模糊继续存在；原生 QWEA0 只增强外缘，不声称整块内容已经变为原生折射面板。

`GlassSurface` 新增的 frame-only 模式默认关闭，其他菜单的参数与内部布局保持不变。API33以下、省电、减少透明效果、不可用 GPU/Shader 或越界矩形时保留原 DOM 面板；关闭/导航时移除材质层。跨设备驱动、键盘动态和实际视觉效果仍须用户验收。

## 交付

versionCode 28，versionName 0.8.0。仅运行发布 APK 所需编译、打包、签名和产物完整性步骤。不运行 UI/模拟器/Instrumentation/截图对比/性能基准/全量回归/安全扫描。Git 历史及源代码定位不属于视觉验收，也不代表运行测试已通过。用户安装后验收；不部署 Cloudflare。
