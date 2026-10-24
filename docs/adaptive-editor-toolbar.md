# Android 自适应编辑工具栏与菜单锚点

基线：e8e8d161e2dfa10319e79947deb878498dc4e809，build62。

## 官方参考与 Easybook 扩展

- Apple iOS26 官方功能表 https://www.apple.com/os/pdf/All_New_Features_iOS_26_Sept_2025.pdf ，Notes 的“An adaptive toolbar”说明按当前编辑内容调整相关工具；并未承诺一种固定按钮顺序。
- iOS26 用户指南 https://support.apple.com/guide/iphone/create-and-format-notes-iph1ac0b3a2/26/ios/26 ，格式入口包含标题、粗体、斜体、高亮，可滑动格式栏快速访问常用样式。
- Apple 支持页面及实机界面说明 https://support.apple.com/en-gb/118442 ，区分格式、附件与笔记更多入口。该页面配图部分标注 iOS18或更高版本，不把旧配图冒称为 iOS26 的固定布局。

以下具体上下文规则、入口顺序、去重和菜单放置为 Easybook 的适配设计，不声称是 Apple 的固定按钮排列或完整功能复制。

## Android-only 工具栏

读取 index.html 的现有18个入口及 rich-editor.js 公开 API 后，仅通过 Android 注入 adaptive-toolbar.js 调整现有 DOM 节点，不改 index.html、富文本核心或 Web 整体布局。

- 正文：Aa、B/I/U、最近高亮+颜色下拉、待办、附件。
- 文字选区：B/I/U、删除线、高亮、链接、Aa等。
- 列表光标：列表类型、待办、减少/增加缩进优先，保留文字快捷格式。
- 跨段选区：列表、缩进、引用优先。
- 标题节点：Aa、B/I/U、正文切换及高亮等。

直接读取 ProseMirror selection.$from/$to 的 parent、selection.empty，以及 Tiptap isActive(listItem/taskItem/heading)，不猜 DOM 文本。同一上下文不重排；变化延后180ms；触摸、横向滚动和组合输入期间不应用重排。重用原节点及事件处理，尽量保留首个可见控件位置；滚动起点保持起点。

最近高亮与原颜色选择按钮组成一个主操作+下拉视觉组，没有新增玻璃层。字体颜色、撤销/重做等低频入口退出快捷栏，但仍在完整格式面板的现有入口中。链接在选区快捷栏和附件菜单有清晰路径；完整格式面板保留所有功能。标题上下文的“正文”按钮委托既有 setParagraph 控件，不另写命令实现。

保留原 toolbar 手势、事件和格式状态更新。附件异步路径在原 toolbar 的释放微任务之后续存选区书签；取消附件菜单时释放。更多菜单沿用原处理器，在原本已聚焦编辑器时同轮恢复焦点，减少 blur 引起的键盘闪退。

## 菜单定位

原错误是 menu.js 将弹窗自己的居中/底部矩形传给 NativeGlassMenu，而不是 moreButton/attachmentButton。

现在仅这两种菜单发送真实触发按钮的 getBoundingClientRect，减去 visualViewport offset；原生按 WebView 像素宽度/可视 CSS viewportWidth 转换一次。菜单 shield 与 WebView 同处安全区域内容坐标，不再重复累加状态栏或 IME 高度。DOM 矩形已经包含文档和工具栏横向滚动，不再加 scrollY 或 devicePixelRatio。

- 笔记更多：优先下方，右对齐向屏幕内延伸。
- 附件：优先上方，8dp间隔避开触发按钮/工具栏。
- 保留292dp上限、原圆角、原动画时长、原功能行。按实际自然高度及上下剩余空间选择方向，过长时限定高度并由既有 ScrollView 滚动。
- DOM/scroll/visualViewport/窗口Insets变化时，只发送变化的锚点几何；不重新创建菜单、偷焦点或重新执行命令。旧 Shader、GlassSurface、GlassBackdrop、FormatGlassFrame、format-surface.js 完全不改。
- GPU/省电降级的原 Web 对话框也按相同锚点规则定位。API33以下保留现有非原生菜单路径。

没有 Worker、D1、R2、认证、同步协议、文档模型、文件夹管理、格式面板布局或玻璃渲染改动。不部署 Cloudflare。

## 交付与限制

versionCode31 / versionName0.8.0。仅 Android 编译、APK打包、签名和发布产物检查；不跑模拟器、UI自动化、截图对比、视觉评分、回归或性能基准。

未验证实际输入法、无障碍遍历、不同WebView/设备和横竖屏运行体验。以上是实现规则及源码检查，不是运行测试或视觉验收结果；用户安装后验收。
