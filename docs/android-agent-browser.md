# Android Agent 浏览器

在「设置 → AI → 本地浏览器」下载并安装可选组件。正式版本从同一 GitHub Release 下载匹配设备架构的 APK，核对 SHA‑256、包名和签名后，进入系统安装确认。也可以安装同签名的本地调试组件。在同一设置页可以卸载组件。

安装后，在 Android 的云端模型 Agent 会话中打开「上下文」，选择「联网搜索」「阅读链接」或「对照来源」，填写任务后发送。「使用本地浏览器」可在当前会话中向普通 Agent 请求开放浏览器。首次启动每项任务时，Android 会说明网页摘录将发送给当前模型。

- 「联网搜索」预设允许 AI 访问本次任务找到的公开来源。普通 Agent 搜索、「阅读链接」和「对照来源」使用任务内站点确认，勾选多个来源可一次授权。
- 「设置 → AI → 本地浏览器 → 允许自动搜索」仅在本机生效，允许自动发送公开关键词给 DuckDuckGo。站点授权与现有云端搜索单独管理。
- 工具可以读取已渲染的页面、跟随公开链接、滚动和返回。浏览器工具栏提供接管、恢复、停止和系统浏览器入口。验证码可在接管后手动完成，登录及表单交给系统浏览器。

浏览器使用可选 APK 内的 GeckoView 私密会话和内置扩展。组件运行在独立的 Android 应用沙箱，只有同签名的 Easybook 可以启动和发送操作。Android 核对顶层导航和任务授权，网络通过专用 HTTPS CONNECT 代理。代理连接经验证的公开地址，TLS 仍由 Gecko 验证。浏览器启动时会先验证代理实际生效。页面摘录和链接 ID 仅用于当前任务的模型上下文，Worker 继续通过现有 AI 接口流式返回结果。结束任务时清理浏览器会话。

## 验收

运行 `npm test` 和 `gradle :app:assembleDebug :agent-browser:assembleDebug :agent-browser:testDebugUnitTest`。构建需要 Android SDK 35 和 37.2、AGP 9.5.2 和 Gradle 9.6.0。调试时安装 `app/build/outputs/apk/debug/app-debug.apk` 和 `agent-browser/build/outputs/apk/debug/` 中与测试设备匹配的组件 APK。

本地测试签名构建的主 Release APK 为 8.2 MiB。可选浏览器 Release APK 按 `arm64-v8a`、`armeabi-v7a` 和 `x86_64` 分发，每个约 89–96 MiB。最低 Android API 为 26。

真机上验证组件的下载、验证、安装和卸载，再用已配置的云端模型运行三个预设。确认 JavaScript 渲染页面能被读取，最终回答包含实际打开的来源链接。分别检查默认关键词确认、允许自动搜索、批量站点确认及撤销、跨站重定向、验证码接管、系统浏览器交接、停止与切换会话。代理或浏览器初始化失败时应直接回到对话并显示错误。
