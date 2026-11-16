# Iodash 独立后台

正式入口为 https://iodash.easybook.loonxy.com ，由独立的 easybook-iodash Worker 提供，不复用会员页面的管理入口、账户管理员 ID 或会员登录 Cookie。客户页只保留优惠码输入和使用功能，原 `/api/membership/coupons/admin` 管理接口已移除。

## 首次注册与登录

首次打开输入部署时安全配置的一次性密码，再由设备完成后台 Passkey 注册。生产密码不写入源码、HTML、URL、Git、日志或文档；部署仅保存含随机盐和 pepper 的 PBKDF2-SHA256 校验配置到 Worker secret `IODASH_BOOTSTRAP_CONFIG`。取消注册不消耗初始化机会。通过 WebAuthn 验证后，在独立认证数据库同一事务中认领初始化状态、创建唯一管理员、保存公钥和建立会话；只有一个初始化请求能成功。

注册成功后永久关闭公开初始化接口。没有密码登录或一次性密码重置入口。后续只接受后台已注册的 Passkey，RP ID 和允许的签名来源严格限定为 `iodash.easybook.loonxy.com` 与对应 HTTPS Origin，并要求 resident credential 和 user verification。现有会员 Passkey 不属于此认证域。

可在后台“通行密钥”添加备用凭据。添加和移除要求最近五分钟内通过 Passkey 验证；最多保留 20 个，不能删除最后一个有效凭据。撤销凭据会撤销其关联会话。失去全部 Passkey 时只能由基础设施所有者通过认证数据库的受控维护恢复，不能重新使用首次密码。

## 隔离与约束

认证数据存于独立的 `easybook-iodash-auth` D1，会员应用没有此数据库绑定。会话令牌只以摘要存储，使用 Host-only `__Host-iodash-session` Secure、HttpOnly、SameSite=Strict Cookie，不设置父域 Domain。会话绝对上限八小时，空闲三十分钟失效。所有写入校验精确 Origin、JSON 类型、自定义请求头及独立 CSRF；所有后台数据接口都要求后台会话。

挑战五分钟有效、绑定 Host-only HttpOnly Cookie，并在验证前原子消费。登录校验 credential 的 userHandle、签名、UV、RP、Origin 和认证器计数，按旧计数 CAS 更新。同步 Passkey 的零计数遵循 WebAuthn 标准。密码尝试按全局及 IP 分桶限流，初始化认领在数据库 CHECK 断言事务中完成，重复提交不能创建额外管理员。

根 HTML 仅包含空白管理界面和表单，数据由登录后的 API 获取。页面使用脚本 nonce CSP、禁止嵌入、无 referrer、HTTPS HSTS；登录与后台响应不缓存。Worker 拒绝 workers.dev 等其他 Origin，不把认证扩展到父域名。

## 功能

后台提供优惠码创建、启停、删除、使用记录，概览统计，以及最近 100 条会籍订单、链上接收、归集任务及交易的只读视图。金额按整数微 USDT 显示，链上实际接收和会员余额结算分开。归集视图不暴露签名原始交易、私钥、令牌，也不代替归集服务的执行开关。

优惠码支持 1–32 位，不区分大小写。`POST /api/coupons/:id/delete` 或 `DELETE /api/coupons/:id` 要求后台会话、Origin 和 CSRF。删除未关联订单的优惠码会释放名称；有关联订单时归档并隐藏，停止新使用，保留历史与已锁定订单。已归档优惠码不能通过启用接口恢复。业务库需应用 `0031-coupon-deletion.sql`。

## 部署

先在 AUTH_DB 应用 `admin-worker/migrations/0001-iodash-auth.sql`，按 `admin-worker/wrangler.jsonc` 部署 Worker 并绑定正式自定义域名。业务库沿用当前会员数据迁移，认证库独立且不启用只读副本，避免登录与撤销读取旧状态。首次设置 bootstrap secret 后，普通部署必须保留它及认证数据库，不能重新执行任何清空管理员或开启注册的维护操作。

浏览器客户端复用仓库已锁定的 SimpleWebAuthn Browser 14.0.0，服务器验证使用已锁定的 SimpleWebAuthn Server 14.0.3。构建前安装根目录与 mcp-oauth 依赖。后台 `/licenses` 提供完整开源声明。
