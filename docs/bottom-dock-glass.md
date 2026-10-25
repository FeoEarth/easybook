# 底部悬浮控件玻璃接入

基础 main 71af2cb9 / build71 / versionCode39。原 navigation 中的 searchbar、createFolder、newTop 仅为CSS材质。保留原DOM、固定位置、尺寸、响应式文件夹主页排列、SVG和点击处理。

三个独立GlassSurface分别复用FormatGlassFrame透明前景适配器与当前QWEA0工具栏材质参数；Shader、GlassSurface源码和材质参数未修改。前景只投射原navigation的HTML/CSS/SVG/状态，按各控件实测矩形裁切，不把它们合并成工具栏。按钮token调用原按钮.click()。主WebView只录制一次；GlassBackdrop的消费者通知由两个扩展为列表，以同时支持三块dock与既有菜单。前景位于采样树之外，原控件仅在原生ready后opacity隐藏，避免采样自身和CSS双重模糊。无Bitmap、PixelCopy、CPU图像处理或常驻逐帧循环。

CSS viewport坐标扣visualViewport偏移后转换一次，原WebView/root窗口位置差扣除root padding，复用既有几何桥接。DOM、ResizeObserver、滚动、窗口/visualViewport、主题事件驱动更新。页面隐藏、编辑、多选、设置或任何modal打开时移除对应原生表面；关闭后按原DOM恢复。采样仍随真实内容变化失效，不无限刷新。

搜索未增加第二套输入逻辑。未聚焦时显示只读投影；触摸搜索由原生将焦点交给主WebView原search并显示IME，恢复原CSS搜索控件。输入、光标、选区、清空按钮、键盘和现有搜索处理都由原控件负责；失焦恢复原生玻璃。这是明确限制：聚焦输入期间搜索框使用CSS降级材质，圆形按钮可继续原生渲染。

Web与API33以下继续原控件，增加仅navigation范围的透射填色和减少透明度/不支持blur降级，不宣称Web具备AGSL折射。省电、GPU失败、页面缩放使用既有CSS路径。三个投影WebView有额外内存成本，未做基准；复用现有适配器避免引入另一套引擎。

versionCode40。仅JS语法、Android Release编译/打包/签名与产物检查。未进行UI/模拟器/截图/视觉验收或回归。实际滚动采样、各页几何、焦点与IME、系统栏、主题、返回和性能由用户安装验证。不改编辑器、移动Sheet、长按预览、文件夹业务、同步或后端；worker/ui.mjs只是共用HTML产物。本次不部署Cloudflare。
