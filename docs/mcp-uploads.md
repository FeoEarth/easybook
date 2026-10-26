# MCP 附件上传与配图

沿用现有 R2 v2 manifest 和内容 SHA-256 ID。新增 D1 表仅保存限时上传会话和配额，不建立第二套附件或任务数据库。现有 Web/Android 附件协议和文档 Schema 保持兼容。

| 工具 | 输入 | 返回 |
|---|---|---|
| attachments_prepare_upload | filename、mime_type、size；可选 sha256、request_id(UUID)、provenance | upload_id、status、size、expires_at、chunk_size、parts、upload_method、upload_url、headers |
| attachments_upload_base64 | filename、mime_type、content_base64；可选 sha256、request_id、provenance | upload_id、status=complete、attachment_id、size、mime_type、filename、expires_at、error |
| attachments_complete_upload | upload_id | 同一附件 ID 和完成状态；重复完成幂等 |
| attachments_upload_status | upload_id | 状态、已知大小、有效期、错误代码、已收到分块及字节数 |
| attachments_abort_upload | upload_id | aborted；清理临时分块，禁止取消已登记文件 |
| notes_get_attachments | id；可选 limit、cursor | 附件元数据、节点路径、笔记版本和下一游标 |

所有上传工具要求真实已配对 OAuth 客户端及用户已批准的 attachments.write。原有只读连接不升级；二进制上传票据使用独立的域分离 HMAC，绑定工作区、客户端、会话和有效期，不是工作区同步密钥或 R2 凭据。每次上传、完成和状态调用都复查当前配对与权限；撤销后票据不能继续上传。

## 文件与限额

- image/png、image/jpeg、image/webp、image/gif、application/pdf、text/plain。
- 标准 Base64 小文件最多128 KiB，解码前限制字符串长度，禁止 data URL、非法编码和非规范 padding。
- 分阶段文件最多50 MiB，每块4 MiB，最后一块必须与准备时的剩余字节数一致。采用 identity 传输，内容和 wire 的 SHA-256 相同。
- 会话15分钟有效；每个工作区最多5个有效上传、每天最多60次准备、500 MiB预留容量（UTC日）。每会话最多64次分块请求，包括重试。取消不退回当日预留配额，防止循环占用存储。
- PNG/GIF头和尾标记、JPEG SOF/EOI、WebP RIFF大小、PDF签名、UTF-8文本及二进制控制字符检查。图片尺寸上限10000×10000；JPEG SOF须在前64 KiB内。本功能不是完整恶意软件扫描或通用图像解码器。
- 未开放SVG、HTML、可执行文件、任意URL导入或服务端抓图。来源URL仅保存为引用数据，Worker不访问它，因此不引入URL抓取型SSRF。

## 分阶段示例

1. 调用 attachments_prepare_upload，filename="photo.jpg"、mime_type="image/jpeg"、size=实际文件字节数，可提供 SHA-256。
2. 对返回的 upload_url 替换 {part_index} 为从0开始的序号，用返回的 Authorization 和 Content-Type 头逐块 PUT 原始二进制。URL不含凭据，不允许任意对象路径；票据仅适用于该会话。
3. 调用 attachments_upload_status 检查已收到分块；相同内容的分块可重试，不允许改写已有分块。
4. 调用 attachments_complete_upload。服务器流式读取临时块、检查实际大小/类型/完整SHA-256，再通过原附件 API 校验分块并登记 manifest。
5. 用返回 attachment_id 调用 attachments_attach_to_note，传入最新笔记 version 和 as_image=true。版本变化返回冲突，须重读后处理。

单次内存使用以一个分块为界，不缓存完整50 MiB文件。提交互斥且有可恢复租约；提交中的会话暂不能取消。完成响应可在会话创建后24小时内重试查询。临时块在完成/取消时清理，失败清理可重试，过期会话有界清理并由主Worker每小时清理任务兜底；不删除已登记文件或其他笔记引用的附件。

## 来源信息与配图

provenance 可包含 source_url(HTTPS)、author、license、ai_generated。它们是客户端声明的来源信息，服务器不自动验证版权授权。原 manifest 保留这组元数据，插入图片时把来源及 AI 声明写入普通段落，兼容现有 Android/Web Schema。相同字节复用内容ID；已登记附件的既有来源元数据保留。

Prompt illustrate_notes 的必填参数为 note_ids、image_source(search/generate/existing)；可选 images_per_note(1—5，默认1)、placement(默认正文适当位置)。只提供工作流，不执行上传，不保证客户端具有搜索、生成或读取本地文件能力。客户端必须确认图片相关性和授权，新闻场景不得把 AI 示意图冒充现场照片；缺少文件处理能力时明确说明，不能编造 Base64 或上传成功结果。

## Resources

- easybook://attachments：分页元数据目录。
- easybook://attachments/{attachment_id}/metadata：已有元数据资源，补充来源和可用的图片尺寸。
- easybook://notes/{note_id}/attachments：分页附件引用、路径及版本；分页期间笔记变化返回冲突。

全部为 application/json，不公开二进制内容。附件目录需要 attachments.read，笔记附件列表同时需要 notes.read 和 attachments.read。下载继续使用原有受权限限制的短期链接和安全下载头。

## 验证边界

本地 mcp-upload-test.mjs 使用真实内存 SQLite 和模拟 R2，覆盖 PNG/JPEG、错误编码、超限、MIME伪造、SHA不符、权限及撤销、工作区隔离、重复完成、取消、过期、元数据、Resources、图片插入和原始附件客户端的 v2 下载。

发布阶段 live-mcp-upload-probe.mjs 使用独立、限时、受随机凭据保护的探针 Worker 和随机合成工作区，调用相同 MCP/上传处理器访问真实 Cloudflare D1/R2，验证生产同步API能读到图片笔记，以及 Chromium 实际渲染图片；结束后清理探针与合成数据。该验证采用合成授权上下文，不冒称已经验证用户现有 ChatGPT OAuth 会话，也不读取私人笔记。Android 以共同 wire/文档合同验证兼容，未做真机体验测试。
