# 格式面板完整玻璃覆盖与动态边界

基线 main：7124c43ea3f0e103ff9d005d6de48d09a7f964f6（build60）。

## 代码原因

- GlassSurface.useFormatFrame / clipOutPath 主动挖空中央，只画12dp外缘；中央仍是原 CSS 材质，天然不连续。
- 几何桥接只监听 ResizeObserver、viewport 与 transitionend，且 opacity>.99 才显示。transform 的中间帧没有尺寸变化，不会触发 ResizeObserver，边缘停在旧位置。
- 原面板本身还在 GlassBackdrop 录制的 WebView 中。原生边缘采到已合成的格式面板、文字和 CSS 模糊，产生自身采样/重复过滤的条件。

以上为源码定位；没有进行截图对比或运行视觉验收。

## 完整表面合成

保留 index.html 中的全部格式 HTML/CSS、分组、按钮、间距和命令。FormatGlassFrame 组合：

1. 原编辑器 WebView 的 GPU RenderNode 背景；原格式面板仅在内容投影就绪后 visibility:hidden，保留测量、状态、选区和原处理器。
2. 一块完整 GlassSurface：复用 QWEA0 shader，无中心挖空、无条带遮罩、无额外边缘 RenderNode。中央统一透射/模糊；原 shader 的 SDF 斜面控制边缘折射、高光与色散。
3. 一个仅显示格式控件的透明 WebView，投影原 DOM/CSS/SVG。它不包含 Tiptap、不持有文档或同步数据，不重新生成三列网格。与主 WebView 保持相同 viewport 尺寸，避免媒体查询按较窄面板宽度重新排版；按同一实测矩形裁剪。只有外壳背景/模糊/定位由合成容器接管，内部按钮样式不变。

透明投影取消外壳 CSS 背景和 backdrop-filter，按钮/文字在 GPU 玻璃上保持清晰，采样源不含投影自身。原生与 CSS 不叠加模糊。原底部工具栏完全独立且零修改。

投影点击以稳定短 token 转发至原 button/summary.click()，没有第二套富文本命令实现。标题条和面板的原生浏览器滚动保留，拖动后抑制误点击；选区书签仍由原编辑器控制。投影 WebView 不获取输入焦点，无网络/文件访问；WebMessageListener 限定主 frame 和专用本地 origin，只接收 ready/click。未就绪/失败时原面板保持或恢复可见。

## 坐标与刷新

- DOM getBoundingClientRect 扣除 visualViewport offset 后提供可视 CSS viewport 矩形，按 main WebView 实际像素宽度/viewportWidth 转换一次；然后加入 WebView 与 root 的 window 坐标差。Shader 继续只使用自身局部像素、margin 和实际 Surface 宽高。
- 同一矩形同时决定玻璃 View、前景裁剪、透明内容位置、圆角及 alpha。复用 RuntimeShader，仅几何/材质改变时重建 RenderEffect；背景平移在 RenderNode 录制坐标中更新。
- ResizeObserver、DOM 内容/状态、scroll、visualViewport、窗口布局/Insets 驱动更新。打开与实际 CSS/viewport 动画仅运行最长500ms的有限几何 rAF，关闭期间若 DOM 仍有可见淡出矩形则跟随至 opacity 为0或 display消失，再移除原生表面；结束即停止，不运行常驻逐帧循环。
- DOM/CSS 内容只在实际变化时发送，几何/opacity 更新独立发送。WebView/GPU surface 在关闭后保留复用，页面导航/销毁时释放。
- 格式面板专属参数：10dp GPU blur、10dp边缘位移、低透明度主题染色与1.02饱和度；普通菜单的原参数和布局不变。

没有 Bitmap、PixelCopy、CPU 图像循环或跨帧截图。为保持原布局和清晰文字，增加一个轻量透明格式内容 WebView；它的内存/驱动开销未基准测试。API33以下、GPU失败、省电、减少透明效果或页面缩放时保留历史 DOM 降级。复杂 compositor-only 视频背景、各设备 IME/字体与动态效果尚未实机验证。

## 交付

versionCode30 / versionName0.8.0。仅编译、打包、签名与发布产物检查。不执行 UI、模拟器、Instrumentation、截图、A/B、性能基准、回归或无关扫描。未执行项目不报告通过；用户安装 APK 后验收。未修改 Worker、D1、R2、同步协议、数据模型或底部工具栏，不部署 Cloudflare。
