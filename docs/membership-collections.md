# 自动归集

本服务只移动商户托管的链上资产，不扣减会员余额，不修改订单或会籍。目标地址为原 Account 3：0x08c8fbc8d980b683ca13362bE1687440FCDa2DB6。现有会员扫描与收款服务独立运行。

## 默认策略

每个收款地址、每条链独立计算：余额达到 20 USDT 即排队；否则自首次监测到正余额满 7 天时排队；最小单位为 0.000001 USDT，费用占比过高的零钱继续积累。统一财务调度器每两分钟检查已提交交易，每15分钟检查新归集，启用且配置签名器时按持久租约轮换网络；每次检查两个地址、处理两个任务。

每次转账前读取 finalized 余额，以 eth_estimateGas 估算真实代币转出和必要的原生币补充交易。Gas limit 加 20%，Gas price 加 25% 预算余量。原生币不足时尝试仅覆盖原生币余额的 RPC 状态模拟；节点不支持时等待人工处理，不按固定 Gas 用量盲目补币。

原生币美元报价来自 CoinGecko，超过十分钟或无法获取时等待。Gas 总预算不得超过归集 USDT 的 2%；每链每日最多预留 5 USDT 等值 Gas 成本。预算对补币与后续手续费采用保守计价，可能多预留，不承诺全部用完。每任务最多两次补 Gas，连续五次前置执行失败转为人工检查。阈值、时限及预算均由 Wrangler 变量控制。

## 钱包及配置

默认 COLLECTION_ENABLED=false。COLLECTION_XPRV 和 COLLECTION_JOB_TOKEN 必须通过独立归集 Worker 的 secrets 配置，不放入主站、数据库、Git、日志或聊天。COLLECTION_XPRV 是已有收款父分支 m/44'/60'/0'/0 的扩展私钥，不是单个 Account 3 的私钥。使用前必须与数据库固定的公钥哈希匹配；来源地址按 address_id + address_offset 重新派生并核对。

COLLECTION_GAS_INDEX 默认 0，即该父分支下 Account 1，用作专用 Gas 钱包。它必须与所有收款地址不同。四条链使用同一 Gas 钱包地址，但各自需要原生币 AVAX、XPL、POL、ETH。不要同时在其他钱包手动使用该 Gas 钱包发送交易；外部待确认 nonce 会使服务等待。配置密钥后可在可信运行环境派生其公开地址，核对后再充值。不要通过聊天发送密钥。

原测试助记词曾披露，不适合商业资金。商业使用独立的新钱包及签名密钥，迁移方案应另行核对。已经派生的收款地址只能由对应的原父分支签名，替换主钱包地址或私钥不会取得这些地址的控制权。

先应用 0029-membership-collections.sql，再部署 collection-worker/wrangler.jsonc。配置 secrets 并确认专用 Gas 钱包已充值后，才将 COLLECTION_ENABLED 设置为 true。没有签名密钥时任务显示 waiting_signer，没有 Gas 时显示 gas_pool_insufficient；两者都不代表归集成功。disabled 状态不再发现新任务，只确认已持久化的交易。

## 持久化与重试

任务独立存储在 membership_collection_watch、membership_collection_jobs、membership_collection_tx，按链加租约。同一地址同一链只允许一个未完成任务。

离线签名后先把原始交易和预期哈希写入数据库，再广播；广播超时后只重播同一份字节，保留相同 nonce 和哈希。状态推进前检查回执、finalized 区块及规范区块哈希。代币归集必须出现来源、目标、代币和金额均匹配的 Transfer 日志，才标记 completed。补 Gas 确认后重新估算，再决定归集，避免重复补充。

签名用 ethers，广播前重新解析并核对发送人、收款合约、chain ID、nonce、value、gas 与 calldata。nonce 冲突、代币转账日志缺失等进入 blocked/attention，保留记录并停止再次转出；不会因为请求超时换 nonce 重复扣款。已完成的归集任务保留，新增充值重新开始计时。

Worker 无公网入口；内部受信服务调用仍须通过 COLLECTION_JOB_TOKEN 访问 GET /status 和 POST /run?chainId=9745。原 workers.dev URL 不再作为管理入口。POST /retry 接受 jobId，可重新排队前置失败任务；遇到 nonce 冲突或缺失 Transfer 日志的 attention 交易必须先人工核查，不能直接重试。状态接口不返回签名原始交易或密钥；不能把令牌放进 URL 或前端。可在 Cloudflare D1 控制台只读查询上述三张表，查看任务原因和 Gas／归集交易哈希。

此服务未替代会员收款日志：归集方向是商户内部转移，链上收款记录仍只显示收到的 USDT。
