# 自建服务器与账户

自建实例的数据、工作区密钥和账户会话与官方实例相互独立。添加或切换服务器不导入、迁移或合并另一服务器的数据。服务器不可达、认证失败或返回重定向时，客户端不得将该服务器的密钥、账户令牌或待同步内容发送给官方实例或其他实例。

## 地址与账户能力

`PUBLIC_ORIGIN` 指定本实例公开地址，默认为 `https://easybook.loonxy.com`。自建时必须显式设置为自己的地址，例如 `https://notes.example.com`。它是 HTTP/HTTPS origin，不能包含用户名、密码、路径、查询参数或 fragment；末尾 `/` 会规范化。非默认端口属于 origin 的一部分。

- HTTPS 实例可以提供账户登录、通行密钥、GitHub 登录、二维码登录和账户工作区同步。
- 内网 HTTP 实例仅提供密钥同步。账户和 OAuth 端点拒绝 HTTP，请求返回 `account_https_required`；不会通过降低 Cookie、Origin 或 RP 校验来开启 HTTP 账户登录。
- HTTPS 网页不能直接连接 HTTP 实例；Web 的 HTTP 仅限 localhost 开发环境。Android 可使用私网 HTTP 密钥同步。浏览器对内网访问还可能要求用户授权。

自建 `PUBLIC_ORIGIN` 不启用官方旧域名恢复流程，不会把登录或通行密钥恢复请求转到官方域名。原有官方主域与官方旧域之间的兼容行为仅适用于默认官方实例。

## 部署资源与开关

自建完整账户服务需要部署 `worker` 与 `mcp-oauth` 两个 Worker，并使用自己的资源绑定，不能复制仓库中指向官方资源的 ID：

| 资源或绑定 | 配置要求 |
| --- | --- |
| `DB` | 两个 Worker 绑定同一个本实例业务 D1，包含账户、会话、工作区、笔记与相关迁移。 |
| `OAUTH_KV` | 绑定到 `mcp-oauth`，保存本实例 OAuth Provider 数据。 |
| `ATTACHMENTS` | 两个 Worker 绑定同一个本实例 R2 附件桶。 |
| `IDENTITY_SERVICE` | `worker` 的服务绑定指向本实例的 `mcp-oauth` Worker。 |
| `PDF_ASSETS` | `worker` 的静态资源绑定，提供本地 PDF 资源及法律说明副本。 |
| `SECURITY_DB` | 两个 Worker 绑定同一个独立安全 D1，不能与业务 `DB` 混用。 |

完整账户部署在两个 Worker 中保持以下配置一致：

```text
PUBLIC_ORIGIN=https://notes.example.com
WORKSPACE_IDENTITY_V2=true
IDENTITY_CANONICAL_V2=true
SECURITY_CHECKPOINT_V2=true
```

启用 `SECURITY_CHECKPOINT_V2` 前，先完成独立安全库及业务恢复状态的初始化；只建立空表不足以启用服务。安全库迁移在 `worker/security-migrations/`，初始化与恢复流程见 [安全恢复操作说明](security-restore-runbook.md)。该说明含官方实例历史记录，自建操作应针对自己的资源执行，不能重置或覆盖官方检查点。

匿名新建工作区还需要本实例的 `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET` 和 `TURNSTILE_HOSTNAMES`；允许的 hostname 必须与实际完成人机验证的页面对应。GitHub 登录需要本实例的 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 及已在 GitHub OAuth App 注册的回调地址。凭据通过 Worker secret 配置，不放入网页或版本库。

自建实例的 GitHub 回调默认为 `${PUBLIC_ORIGIN}/callback`。如设置 `GITHUB_REDIRECT_URI`，必须与这一地址精确一致；自建实例不能使用官方回调。

## 从另一 HTTPS 网页登录

在当前网页连接另一 HTTPS 实例时，登录页面在目标实例自己的 origin 中打开。通行密钥或 GitHub 登录与批准使用目标实例的第一方 Cookie；返回当前网页的只有短期一次性授权码。当前网页随后使用本次发起登录时保存的 PKCE verifier 兑换独立 Web 会话令牌，后续 API 请求使用显式的 `Authorization: Easybook-Web <token>` 和 `credentials: 'omit'`，不依赖第三方 Cookie。

允许其他网页连接的实例需要同时配置精确的客户端 origin 和回调白名单。例如允许官方网页作为本实例的客户端：

```text
WEB_CLIENT_ORIGINS=https://easybook.loonxy.com
WEB_CLIENT_REDIRECT_URIS=https://easybook.loonxy.com/server-callback
```

这两项支持逗号或换行分隔，也支持 JSON 字符串数组。白名单不是域名通配规则：scheme、host、port 必须精确匹配；回调路径固定为 `/server-callback`，不允许额外查询参数或 fragment。回调 origin 必须也在客户端 origin 白名单中。本实例自己的 origin 与 HTTPS `/server-callback` 默认允许，不需要重复配置。

请求流程为：

1. `POST /account/web/start` 提交 S256 `challenge`、`state`、`redirect_uri`。
2. 打开返回的 `/account/web/authorize` 地址，在目标站点登录并批准该网页。
3. 目标站点返回已允许的回调，携带 `server`、`flow`、一次性 `code` 与 `state`。
4. 回调页通过同 origin 的 `BroadcastChannel` 通知发起页面。发起页面验证服务器及 pending state，再调用 `POST /account/web/token`。
5. `GET /account/web/session` 查询该 Web 会话，`POST /account/web/logout` 撤销会话。

授权码、客户端 origin、回调地址、PKCE challenge 与目标服务器绑定。登录交接有效期为 300 秒；令牌兑换只能成功一次。新 Web 会话保留源会话的认证时间和通行密钥因子，并使用账户会话的到期、撤销与安全检查；交接不会获得一次新的“最近验证”。原生 `Easybook-Session` 仍拒绝浏览器 Origin，不能拿来替代 Web 令牌。

跨站 CORS 只对已配置的客户端 origin 返回允许头，不允许使用另一个实例的 Cookie 或账户令牌进行认证。客户端必须把服务器身份与工作区、账户会话、同步游标和待同步操作一起保存；服务器切换不改变这些数据的归属。

## 通行密钥与 Android

浏览器通行密钥的 RP ID 使用 `PUBLIC_ORIGIN` 的 hostname，验证 origin 包含实际 scheme 和端口。已有官方通行密钥不能自动用于自建实例。

官方 Android APK 连接自建 HTTPS 服务器时，通过系统浏览器完成账户登录与通行密钥验证，再用绑定服务器的 PKCE 流程返回应用。原生 Credential Manager 仅保留官方域名流程，不自动为任意自建域名建立 Android 站点关联。

## Web 会话迁移

新增迁移是：

- `worker/migrations/0022-web-accounts.sql`
- `mcp-oauth/migrations/0011_web_identity.sql`

两份迁移针对共享业务 D1，内容相同且可重复执行，增加 `account_web_logins` 与 `account_web_sessions`。它们不迁移其他服务器的数据，也不复用官方账户授权。部署前仍需要已有账户、通行密钥和工作区迁移，不能仅应用这两份文件到空库。

本文描述本地实现和部署配置要求，不表示已部署自建实例或完成 Android 实机验收。
