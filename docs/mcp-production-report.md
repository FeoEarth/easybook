# Easybook MCP 全能力交付报告

代码已合并并部署。生产代码提交：`2d109bc9b394ac65f5f07e5e71ae349271e270eb`；功能合并 PR：[76](https://github.com/FeoEarth/easybook/pull/76)。

## 能力目录

- 第一、第二、第三批共47个业务工具全部实现；另有2个权限/确认辅助工具、3个兼容别名、5个原有配对工具，总计57个工具入口。
- Resources：7个静态资源、7个动态模板；MIME、用途和权限见[完整目录](mcp-full-capabilities.md)。
- Prompts：26个中文工作流模板。全部参数、用途和使用示例见[完整目录](mcp-full-capabilities.md)，精确输入结构见[JSON Schema 目录](mcp-catalog.json)。

## 当前生产版本

日志脱敏设置在 Cloudflare 形成了同一代码提交的新配置版本。下面列出实际当前版本，而非仅列最初候选版本。

| Worker | Deployment ID | Version ID | 流量 |
|---|---|---|---|
| easybook-sync | 58e7443f-dd85-458f-af83-7d3901d52af7 | b344b81b-adfd-4788-8a48-c002a2077a25 | 100% |
| easybook-mcp-oauth | 904afa77-a888-4377-8da7-28730f2ad856 | 2725c73a-19e2-4a13-860a-9f6ebb618393 | 100% |

两个当前版本的 RELEASE_SHA 均为上述代码提交，DB、R2、KV、既有密钥绑定名称保留。两 Worker 的 redact_query_string 已通过 Cloudflare API 复查为 true。生产两个 `/health/mcp` 均返回 HTTP 200、mcp_schema_revision=8。

数据库通过已连接的 Cloudflare 完成新增表和触发器迁移；未读取私人笔记进行开发测试。GitHub Actions 原有 Token 缺少 D1 导入权限，因此发布流程改为在候选阶段通过 Worker 的运行时绑定验证 schema，未扩大该 Token 权限。结构缺失时检查失败并阻止晋升。

## 验证证据

| 检查 | 结果和范围 |
|---|---|
| MCP专项 | 49工具和3别名全部成功调用；14资源、26提示词全部通过。真实内存SQLite和合成R2，非用户数据 |
| 安全/编辑 | 只读拒绝写入、跨工作区拒绝、版本冲突、确认参数和客户端绑定、防重放、下载撤销、嵌套任务、marks和表格保留、大文档分页通过 |
| 同步接口 | JSON创建/读取、CAS、持久重试回执、payload不匹配、cursor/删除记录、工作区隔离和事务回滚通过 |
| 原有配对 | initialize、工具发现、挑战码/HMAC、CORS、配对完成、重放与撤销通过 |
| 生产Web | 候选与生产真实Chromium启动、列表菜单、新建编辑器、editor.js、health通过；使用随机合成工作区 |
| 生产OAuth | discovery、未授权401、配对CORS和错误反馈通过；跨Worker有效HMAC到达未知挑战码拒绝通过 |
| 数据库 | 6张控制/派生表和2个触发器存在；两个生产运行时schema readiness为8 |
| 发布/回滚 | 两个正式发布工作流成功，绑定无数据回滚探针验证成功 |

发布记录：[主Worker](https://github.com/FeoEarth/easybook/actions/runs/40262079513)、[OAuth Worker](https://github.com/FeoEarth/easybook/actions/runs/40262079626)、[MCP专项CI](https://github.com/FeoEarth/easybook/actions/runs/40262079505)。

真实 ChatGPT 客户端持有的 OAuth 会话未暴露给本次执行环境，因此没有将真实客户端会话内的新工具调用报告为已验证。客户端需刷新 Easybook 连接以重新发现能力；若客户端不展示 Resources/Prompts，仍可使用 Tools。未替用户完成写入权限批准。

既有全量媒体工作流仍因旧测试点击已不存在的 newTop 按钮失败。本次未修改页面或编辑器，已完成相关同步接口及生产浏览器检查；该旧测试未被报告为通过。

## 使用方式和边界

现有配对继续只读。需要写入时，调用 `access_request_permissions` 获取确认链接，由用户在已连接正确工作区的 Easybook Web 检查并批准。高风险批量操作、空文件夹删除和附件停用须另以 `operations_request_confirmation` 申请精确参数的一次性人工确认。AI不能代替用户批准。

资源订阅不支持且未声明。永久清除不开放；附件删除仅为停用，保留R2字节以保护离线设备和已有引用。任务统计派生于原始taskItem，旧数据每次最多补齐10篇，未齐全时明确标注。附件总数不可靠时为null。设备同步状态未知时不声称设备已同步。所有限制详见能力目录。

## 修改文件（31个代码/文档/工作流文件）
- `.github/workflows/deploy-cloudflare.yml`
- `.github/workflows/deploy-mcp-pairing.yml`
- `.github/workflows/mcp.yml`
- `docs/mcp-capability-audit.md`
- `docs/mcp-catalog.json`
- `docs/mcp-full-capabilities.md`
- `mcp-oauth/src/index.mjs`
- `mcp-oauth/wrangler.jsonc`
- `scripts/cloudflare-release.mjs`
- `scripts/generate-mcp-catalog.mjs`
- `scripts/mcp-capabilities-test.mjs`
- `scripts/mcp-pairing-release-test.mjs`
- `scripts/mcp-test.mjs`
- `scripts/oauth-release-smoke.mjs`
- `scripts/web-release-smoke.mjs`
- `worker/index.mjs`
- `worker/mcp-access.mjs`
- `worker/mcp-attachments.mjs`
- `worker/mcp-common.mjs`
- `worker/mcp-folders.mjs`
- `worker/mcp-health.mjs`
- `worker/mcp-notes.mjs`
- `worker/mcp-prompts.mjs`
- `worker/mcp-registry.mjs`
- `worker/mcp-resources.mjs`
- `worker/mcp-services.mjs`
- `worker/mcp-tasks.mjs`
- `worker/mcp-workspace.mjs`
- `worker/mcp.mjs`
- `worker/migrations/0008-mcp-capabilities.sql`
- `worker/wrangler.jsonc`
