# Easybook 0.8.0 第四阶段：图片、附件与同步活动

基线 main：`bdf0fe2ef0f7a32a2fbe027694dd52187a0aca96`。已读取阶段二/三实现文档与附件实现，复用现有 schemaVersion 1、离线 outbox、Web IndexedDB、原生私有附件存储及私有 R2。没有 D1 迁移、凭据变更、附件公共 URL 或第二套同步引擎。

## 增量实现

- 为现有 image/attachment 增加仅视图层 NodeView。新选取的 PNG/JPEG/GIF/WebP 使用 image 节点，在保存的光标位置插入；其他文件使用原有 attachment 节点。支持多文件选择，图片等比例适配、卡片显示名称/类型/大小/同步状态，加载失败可重试。Blob URL 不进入文档 JSON，离开引用时回收；二进制继续以 SHA-256 缓存。删除节点不删除本地或远端文件，保护其他引用。
- 全屏图片预览：双指缩放、拖动、双击缩放、鼠标滚轮、左右切换/滑动、关闭和保存/分享。TXT 使用 textContent 安全展示；Web PDF 使用浏览器 PDF 查看器，不支持时提示保存；Android 增加基于系统 PdfRenderer 的内部阅读器（翻页/缩放）。音视频使用 HTML 原生 controls；Office 和其他文件走 Android 外部应用或 Web 保存/系统分享，没有文档转换引擎。
- Android 原生授权增加精确的 attachment.open/share 和 sync.activity 方法。附件仍须被当前空间笔记引用；分享只授予私有缓存 FileProvider 的临时只读 URI，provider 和 PDF Activity 均不导出。没有放宽 WebView 来源、网络代理、凭据或路径访问。
- 同步活动从设置/列表状态进入，没有新增悬浮按钮。统一 task ID、状态、方向、时间、错误与重试，保留最近 60 条完成/冲突记录。笔记不显示百分比；文件显示实际 JSON/base64 传输字节（不同于原始文件大小），没有 Content-Length 时仅显示已传字节。
- Web 观察现有 request 与持久化确认；Android 观察现有 NativeSync/AttachmentStore，并在本机 settings 保存活动快照。进度到 100% 仍是正在同步，只有原协议确认并完成本机落盘才标记完成。冲突继续生成并保留副本。重试沿用旧 outbox/mutation/hash ID；网络恢复/应用返回后使用原有同步入口，关闭活动页面不取消或丢弃队列。
- 内容哈希去重，同时避免再次选择已同步相同文件导致重复上传。下载落盘前校验 ID、大小、SHA-256。保留原 5 MiB 单文件上限，不新增依赖。
- 待办修复、原有全部 CSS 前缀、悬浮工具栏 DOM 与定位、格式/光标/中文 composition 逻辑均保留。

## 最低验证

通过：`npm run test:media`（真实应用 DOM + fake IndexedDB/模拟传输，包含光标插入、图片/卡片、JSON 重载、全屏打开/双击/双指事件/切换/关闭、TXT 安全展示、PDF iframe 路由、排队/进行中/失败/确认成功、真实事件字节记录、离线恢复、去重重试、模拟跨客户端重新下载、历史上限）；复用附件接口测试验证哈希/大小、幂等、401、空间隔离。

通过：原有 `format-editor-test.mjs`、`task-node-test.mjs`；六个改动/新增 Java 文件语法解析。静态比对确认原工具栏 DOM 及完整既有 CSS 未变。更新 Android/Web 生成产物。

未验证：Android SDK 编译、模拟器/实机、真实中文输入法、真实触控/像素排版、原生 PdfRenderer 的文件兼容性与系统保存/分享/外部打开、浏览器 PDF 插件实际翻页缩放、真实 Android↔Web 联测。DOM 模拟不代表这些已通过。没有运行全量回归或构建 APK；提交独立 phase4 分支，避免 main 推送自动触发 APK 构建。

## Cloudflare

只部署现有开发 Worker `easybook-sync` 的共享 UI/editor 资源，服务端 API 源码不变；维持现有 DB（easybook-data）和 ATTACHMENTS（easybook-attachments）绑定、兼容日期和日志设置。无路由/域名修改、无数据迁移/删除/密钥重置，R2 不公开。

部署成功：`62363242f1b945d1ba9f4c4424a1d3a8`。线上 `/` 和 `/editor.js` 与本次生成文件逐字节一致，`/health` 返回 200。线上附件未授权请求返回 401；随机新空间读取不存在对象返回 404。未读取用户笔记/附件内容、未写入测试数据。
