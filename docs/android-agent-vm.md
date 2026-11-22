# Easybook Agent｜Android 本地 QEMU Linux 虚拟机（阶段三，实验性）

此后端是 **QEMU system emulation 的完整 Linux 客体**，不是 PRoot。Android Easybook 与 Termux 不共享文件目录；Agent 生成的 Python/Shell 代码使用固定的 Termux 启动器通过经过主机密钥校验的 SSH 送入客体 Linux 执行。这个执行后端默认关闭，并且在每个 Agent 会话中单独选择。它不会将 Linux / QEMU 组件加入 APK，也不需要 Root。

**交付条件：** 本次包含 Android / Termux 命令桥接、回执、后端切换、脚本和安装指引。需要用户手工安装独立 Termux、受信任的 Linux ARM64 镜像、QEMU、SSH 密钥并先启动客体系统；在没有真实镜像与 Android 16 真机验证之前，不能声称这是开箱即用的 VM。

## Android 安装、权限与风险

1. 从可信渠道安装 Termux **0.109 或更新版本**。不能依赖 Android 应用数据目录执行从网上解压的 Linux 二进制。
2. 在 Termux 执行 `pkg update && pkg install openssh coreutils qemu-system-aarch64-headless qemu-utils`。实际包名请按所用源检验。
3. 设置 `~/.termux/termux.properties` 中 `allow-external-apps = true`，运行 `termux-reload-settings`。Android 系统设置 → Easybook → 权限 → 其他权限，明确授予 **Run commands in Termux environment**。
4. 在 Easybook AI 设置先开启本地执行环境，再开启 **QEMU Linux 虚拟机**。在具体 Agent 会话的上下文选中 Linux 后端。
5. **注意：** RUN_COMMAND 权限对 Termux 宿主机很广泛。它不等于沙箱或安全的 OS 权限，只应授给可信应用。Easybook 只向固定的 `~/easybook-agent-vm/runner.sh` 发送 Agent 脚本，不直接调用 Bash 在 Termux 执行生成代码。

## 初始化 QEMU 客体

在 Termux 中将源码中的 `tools/agent-vm/runner.sh` 和 `tools/agent-vm/start-qemu.sh` 放置到 `$HOME/easybook-agent-vm/`，并：

```sh
chmod 700 "$HOME/easybook-agent-vm/runner.sh" "$HOME/easybook-agent-vm/start-qemu.sh"
mkdir -p "$HOME/easybook-agent-vm/ssh"
chmod 700 "$HOME/easybook-agent-vm/ssh"
ssh-keygen -t ed25519 -f "$HOME/easybook-agent-vm/ssh/id_ed25519" -N ''
```

从可信渠道手动制作/安装 **Linux ARM64 qcow2 系统盘**，命名为 `guest.qcow2`，并准备相应 ARM64 UEFI 固件为 `QEMU_EFI.fd`。本项目**不下载、不提供、也不修改用户镜像**。启动脚本假定镜像可通过 UEFI 启动；实际固件路径随 Termux 仓库有所不同。以 `start-qemu.sh` 为参考，在 Termux 前台运行：

```sh
"$HOME/easybook-agent-vm/start-qemu.sh"
```

QEMU 参数使用 `-accel tcg`（纯软件模拟），默认约 1 GiB 内存和 2 vCPU；不需要 KVM/root。仅将主机回环的 TCP 2222 端口转发至客体 SSH 22。**不使用共享目录、hostfs、9p、virtiofs 或任何宿主机文件挂载**。客体必须安装 SSH 服务和 Python 3，创建非特权账户 `easybook`，为其建立 `~/work`，将 Termux 的 `id_ed25519.pub` 添加到此账户的 `~/.ssh/authorized_keys`，禁用密码登录并尽可能限制 guest 账号权限。

从客体可信控制台或预先校验的宿主密钥得到 SSH 主机公钥与指纹，在 Termux 中写入 `$HOME/easybook-agent-vm/ssh/known_hosts`。**不能盲目使用 `ssh-keyscan` 接受未知主机密钥**；需要核对客体控制台显示的指纹，以防连到同一端口的其他进程。密钥目录应只由当前 Termux 用户读取。

在 Termux 验证：

```sh
printf 'print("Easybook QEMU guest OK")\n' | "$HOME/easybook-agent-vm/runner.sh" python
printf 'pwd; id\n' | "$HOME/easybook-agent-vm/runner.sh" shell
```

这两条命令**确实通过 pinned SSH 在 guest 中执行**。Termux 只运行已经审查的 launcher 与 SSH 客户端，不对 Agent 生成的文本调用 `eval`、`bash -c` 或 `python -c`。每次执行最长约 32 秒，Android 收据等待最多 45 秒；一次只允许一条 VM 命令。

## 运行和安全限制

- 会话级用户确认：每次执行必须在 Easybook 对话卡片中批准。Android 全局开关+当前会话开关+单独的 VM 启用开关为必备条件。
- 网络：guest 使用 QEMU user-mode NAT，可以联网（与既定网络偏好一致），但不会继承 Easybook 的 Cookie、BYOK Key、同步密钥或本地数据库。
- 文件：QEMU 客体只访问自己的 Linux 虚拟磁盘；JavaScript 沙箱的会话文件和 Easybook 笔记不会自动挂载。用户通过 Easybook 沙箱文件面板自行导入/导出文本，**当前没有自动 guest 文件同步**。
- 客体安全：guest 管理员要定期更新镜像，不要给 `easybook` 账户 sudo 权限。QEMU TCG 不是抗所有虚拟机逃逸漏洞的保证。
- 性能：ARM64 系统模拟有显著开销，内存和储存远大于 JavaScript 沙箱；后台可能被 Android 系统杀死。
- 取消：Easybook 可立即放弃等待结果；已送入 guest 的命令不能保证即时终止，客体端/Termux `timeout` 限制是最后防线。不可宣称强制停止。
- 若 Android 尚未安装 Termux、未授予 RUN_COMMAND 权限、guest 未启动、SSH 主机密钥不匹配，客户端必须显示错误，不应降级成在 Termux 宿主执行 Shell。
- QEMU 启动/停止仍由用户在 Termux 操作。完整的一键安装镜像、虚拟机快照、进度流和客体工作目录交换不属于本次交付。

参照 Termux 官方 RUN_COMMAND Intent 说明及 QEMU ARM64 系统模拟文档：
- https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
- https://www.qemu.org/docs/master/system/target-arm.html
