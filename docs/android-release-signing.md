# Easybook Android 正式签名迁移（方案 A）

当前版本 0.8.12 的公开 APK 使用历史开发证书。用户已选择不兼容旧 APK，新正式签名将成为唯一受信任的 Android 原生 Passkey 证书。**合并和部署前备份旧 APK 的本地数据；新签名不能覆盖安装旧 APK。**

## 1. 在 Android 手机上创建私钥

使用可信来源安装 Termux（用户使用 F-Droid 版），在 Termux 中执行：

```sh
pkg update
pkg install openjdk-17 coreutils
umask 077
mkdir -p "$HOME/easybook-signing"
cd "$HOME/easybook-signing"
keytool -genkeypair -keystore easybook-release.p12 -storetype PKCS12 -alias easybook-release -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10950
```

按提示设置独立的强密码（PKCS12 通常要求密钥密码与密钥库密码相同），不要把密码放进命令行、截图、公开仓库或聊天中。`easybook-release.p12` 是不可公开的**私钥容器**。在离开 Termux 前，将其完整备份到至少两个受加密保护的独立位置，至少有一个离线副本；密码独立保存。验证备份能够读取，切勿只依赖 GitHub Secrets。

查看可公开的证书 SHA-256 指纹：

```sh
keytool -list -v -keystore easybook-release.p12 -alias easybook-release
```

记录输出中证书的 **SHA256**。只有该公开指纹可以发给项目维护者；**绝不发送 `.p12`、密码或 Base64 内容**。

## 2. 保存到 GitHub Actions Secrets

进入 [Easybook Actions Secrets](https://github.com/FeoEarth/easybook/settings/secrets/actions)，或在 Termux 中使用 GitHub CLI：

```sh
gh auth login --web
base64 -w 0 easybook-release.p12 | gh secret set EASYBOOK_RELEASE_KEYSTORE_BASE64 --repo FeoEarth/easybook
```

上面的管道直接将编码后的文件交给 GitHub CLI，不生成额外的明文中间文件；Base64 **不是加密**。请在 GitHub Secrets 页面手动添加剩余三项：

| 名称 | 内容 |
| --- | --- |
| `EASYBOOK_RELEASE_STORE_PASSWORD` | 密钥库密码 |
| `EASYBOOK_RELEASE_KEY_ALIAS` | `easybook-release` |
| `EASYBOOK_RELEASE_KEY_PASSWORD` | 私钥密码（PKCS12 通常与密钥库密码相同） |

不要把 `.p12` 放到仓库、GitHub Actions Cache、Actions Artifacts 或 GitHub Release。Secrets 不是离线备份。完成配置后无需向维护者披露具体值。

## 3. 项目代码及发布门禁

- `app/build.gradle` 仅在四项独立签名输入都存在时才创建 Release signingConfig。缺少输入时普通 CI 只能构建**无签名** Release APK，且不发布；绝不退回开发密钥。
- `.github/workflows/android.yml` 的 PR / 普通推送只进行无签名编译检查，不读取 Release Secrets。
- 只有从 `main` 手动运行 **Build Android APK** 且勾选 `publish_release` 才会读取四项 Secrets、构建已签名 APK、校验签名证书与 Passkey / Digital Asset Links 关联，并在所有步骤成功后发布 GitHub Release。
- 正式发布门禁使用 `scripts/check-android-identity.mjs`，只接受本次正式证书 SHA-256 `6934266cba128c7ea18b39619cc4cb9a2beb0f7f4dc5cb41e93d58c575d096e5`。

## 4. 配置新证书后再正式切换

1. 维护者收到新的**公开 SHA-256 证书指纹**后，审查并更新 `worker/android-identity.mjs`、Digital Asset Links、Passkey Android 来源校验及其安全测试。按用户确认不兼容旧 APK 的决定，移除旧证书信任；新证书是唯一认可的 Android 签名来源。
2. 先部署 Cloudflare 身份关联变更并确认 HTTPS `/.well-known/assetlinks.json` 与认证端的接受来源正确；验证新证书 SHA-256 与实际 APK 一致。
3. 核对 Android `versionCode` 相比上一发行版单调递增，必要时升级版本号，再手动触发新正式签名发布。不可在新证书关联完成前发布 APK。
4. 旧版 APK 的 Android 原生 Passkey 登录在身份服务切换后将不再受支持。在卸载旧 APK 前，**从 Android 导出并独立验证可恢复的完整备份**，确认本地独有笔记与附件没有遗漏；确认远程同步状态。不同签名的 APK 一般不能覆盖安装，卸载旧应用可能清除它的本地数据与凭证。备份确认后才卸载并安装新 APK，恢复数据和必要的登录 / Passkey 关联。

## 5. 注意事项

- APK 的 SHA-256 文件摘要（`SHA256SUMS.txt`）与**签名证书的 SHA-256 指纹**是两种不同的值，不要混淆。
- Android Release 使用新证书后，后续同一包名的更新应持续使用同一正式签名。失去私钥可能使现有用户无法正常升级。
- Google Play App Signing 若在未来启用，需要单独规划分发证书与上传密钥；当前方案面向 GitHub Release 直接分发 APK。
