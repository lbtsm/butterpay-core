# ButterPay Phase 1 详细设计文档

> 版本：1.0
> 日期：2026-04-10
> 范围：商户服务 + Web 支付（用户用自己钱包）

---

## 一、Phase 1 目标

能收钱，任意币种，商户有 Dashboard 和对账。用户用自己的钱包（MetaMask / OKX / Rabby 等）通过 Web 支付页付款。

**一句话**：商户调 API 创建 Invoice → 用户跳转 Web 支付页 → WalletConnect 连钱包 → 付款 → Webhook 通知。

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        接入层                                │
│                                                             │
│  Web 支付页（Next.js，基于 viem 直接交互）                     │
│  ├── /pay/[invoiceId]   托管支付页                           │
│  ├── /pay/link          支付链接页（固定/自定义金额）            │
│  └── /dashboard         商户 Dashboard                       │
├─────────────────────────────────────────────────────────────┤
│                        SDK 层                                │
│                                                             │
│  @butterpay/core                                            │
│    ├── ExternalWalletAdapter（EIP-1193 注入钱包）              │
│    ├── CryptoPaymentProvider                                │
│    │   ├── pay()           稳定币直接支付                     │
│    │   ├── swapAndPay()    非稳定币 DEX swap + 支付            │
│    │   ├── scanBalances()  多链余额扫描                       │
│    │   └── ensureApproval() ERC20 授权管理                    │
│    ├── ApiClient（Invoice CRUD + tx 提交 + 状态轮询）          │
│    └── ButterPay 主入口（编排 wallet + provider + API）        │
├─────────────────────────────────────────────────────────────┤
│                        后端服务                               │
│                                                             │
│  Payment API（Fastify + TypeScript）                         │
│    ├── Invoice CRUD        POST/GET /v1/invoices             │
│    ├── Tx 提交             POST /v1/invoices/:id/tx          │
│    ├── 对账 API            GET /v1/transactions + summary     │
│    ├── CSV 导出            GET /v1/transactions/export        │
│    ├── 余额查询            GET /v1/balances                   │
│    ├── 退款标记            POST /v1/invoices/:id/refund       │
│    ├── DEX 报价            GET /v1/quotes                     │
│    └── 稳定币查询          GET /v1/chains/:chain/stablecoins  │
│                                                             │
│  Tx Tracker         轮询 txHash 确认到账（viem multi-chain）    │
│  Webhook Service    两阶段通知 + HMAC 签名 + BullMQ 重试        │
│  Depeg Monitor      60s 轮询稳定币价格，>5% 自动禁用            │
│                                                             │
│  PostgreSQL（8 张表）+ Redis（BullMQ 队列）                    │
├─────────────────────────────────────────────────────────────┤
│                        链上合约                               │
│                                                             │
│  PaymentRouter（EVM 多链：Arb / BSC / Polygon / OP / ETH）   │
│    ├── pay()             稳定币支付（需 approve）              │
│    ├── payWithPermit()   EIP-2612 permit 支付（一次签名）       │
│    └── swapAndPay()      非稳定币原子 swap + 支付              │
├─────────────────────────────────────────────────────────────┤
│                        外部依赖                               │
│                                                             │
│  RPC（公共节点 / Alchemy / QuickNode）                        │
│  DEX 聚合器（1inch / ButterSwap）                             │
│  价格 API（CoinGecko / DeFiLlama）— 脱锚监控                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、链上合约详设

### 3.1 PaymentRouter

**文件**：`contracts/PaymentRouter.sol`（236 行）

**职责**：统一支付入口，非托管，所有操作在一笔交易内完成。

#### 3.1.1 数据结构

```solidity
struct PaymentParams {
    bytes32 invoiceId;       // 唯一 Invoice 标识（keccak256(invoiceId string)）
    address token;           // ERC20 地址（USDT/USDC）
    uint256 amount;          // 总支付金额（含服务费）
    address merchant;        // 商户收款地址
    address referrer;        // 渠道商地址（address(0) 表示无）
    uint16  serviceFeeBps;   // 服务费基点（50 = 0.5%, 80 = 0.8%）
    uint16  referrerFeeBps;  // 渠道商费（从服务费中扣）
    uint256 deadline;        // 过期 UNIX 时间戳
}

struct PermitParams {
    uint256 value;           // 授权金额
    uint256 deadline;        // 签名过期时间
    uint8 v; bytes32 r; bytes32 s;  // EIP-2612 签名
}

struct SwapParams {
    bytes32 invoiceId;
    address inputToken;      // 用户持有的 Token（如 WETH）
    address outputToken;     // 商户接收的稳定币（如 USDT）
    uint256 inputAmount;     // 输入数量
    uint256 minOutputAmount; // 最小输出（滑点保护）
    address merchant;
    address referrer;
    uint16  serviceFeeBps;
    uint16  referrerFeeBps;
    uint256 deadline;
    address dexRouter;       // DEX 路由合约地址
    bytes   dexCalldata;     // 编码的 swap 调用数据
}
```

#### 3.1.2 三种支付方式

| 方法 | 场景 | 用户签名次数 | 流程 |
|------|------|------------|------|
| `pay()` | USDT 等不支持 permit 的 Token | 2 次 | tx1: approve → tx2: pay |
| `payWithPermit()` | USDC 等支持 EIP-2612 的 Token | 1 次 | 链下 permit 签名 + tx: payWithPermit |
| `swapAndPay()` | 非稳定币（WETH/WBNB 等） | 2 次 | tx1: approve → tx2: swapAndPay（原子 swap + 分发） |

#### 3.1.3 pay() 流程

```
用户调用 pay(params):
  1. 校验：未支付 / 非零商户 / 非零 Token / 金额>0 / 费率<=5% / 未过期
  2. 标记 isPaid[invoiceId] = true（CEI 模式，先标记再转账）
  3. 计算费用：
     serviceFee = amount * serviceFeeBps / 10000
     referrerFee = amount * referrerFeeBps / 10000（从 serviceFee 中扣）
     collectorFee = serviceFee - referrerFee
     merchantReceived = amount - serviceFee
  4. 转账（SafeERC20.safeTransferFrom）：
     用户 → 商户：merchantReceived
     用户 → fee collector：collectorFee
     用户 → referrer：referrerFee（如有）
  5. 发出 PaymentProcessed 事件
```

#### 3.1.4 payWithPermit() 流程

```
用户调用 payWithPermit(params, permit):
  1. 同 pay() 的校验
  2. 标记 isPaid
  3. 调用 IERC20Permit.permit() 设置授权（try/catch 兜底）
  4. 同 pay() 的转账逻辑（_executeTransfers）
```

**permit 失败处理**：如果 permit 签名无效（已授权、重放等），try/catch 静默忽略，依赖已有的 allowance。如果真的没有 allowance，transferFrom 会自然 revert。

#### 3.1.5 swapAndPay() 流程

```
用户调用 swapAndPay(params):
  1. 校验（含 DEX 路由白名单检查）
  2. 标记 isPaid
  3. 从用户拉取 inputToken 到合约
  4. approve DEX router 使用 inputToken（forceApprove）
  5. 记录 outputToken 余额（balBefore）
  6. 调用 dexRouter.call(dexCalldata)（外部调用）
  7. 计算实际 outputAmount = balAfter - balBefore
  8. 校验 outputAmount >= minOutputAmount（否则 revert，用户无损失）
  9. 分发 outputToken（商户 + fee collector + referrer）
  10. 退还剩余 inputToken 给用户
  11. 发出 SwapPaymentProcessed 事件
```

#### 3.1.6 安全机制

| 机制 | 说明 |
|------|------|
| ReentrancyGuard | 防重入攻击 |
| Pausable | 紧急暂停 |
| CEI 模式 | 先标记 isPaid 再转账 |
| 费率硬上限 | MAX_SERVICE_FEE_BPS = 500（5%） |
| 双付检查 | isPaid mapping 防止同一 Invoice 重复支付 |
| DEX 白名单 | allowedDexRouters mapping，只允许审计过的 DEX |
| Token 白名单 | 可选开启，只允许指定 Token |
| 截止时间 | deadline 过期自动拒绝 |
| SafeERC20 | 兼容非标准 ERC20（USDT 等） |

#### 3.1.7 管理员函数

| 函数 | 权限 | 说明 |
|------|------|------|
| `setServiceFeeCollector(address)` | Owner | 更换费用收集地址 |
| `setTokenWhitelist(address, bool)` | Owner | 管理 Token 白名单 |
| `setTokenWhitelistEnabled(bool)` | Owner | 开关白名单 |
| `setDexRouter(address, bool)` | Owner | 管理 DEX 路由白名单 |
| `pause()` / `unpause()` | Owner | 紧急暂停/恢复 |

#### 3.1.8 事件

```solidity
event PaymentProcessed(
    bytes32 indexed invoiceId,
    address indexed payer,
    address indexed merchant,
    address token, uint256 amount, uint256 merchantReceived,
    uint256 serviceFee, uint256 referrerFee
);

event SwapPaymentProcessed(
    bytes32 indexed invoiceId,
    address indexed payer,
    address indexed merchant,
    address inputToken, uint256 inputAmount,
    address outputToken, uint256 outputAmount,
    uint256 merchantReceived, uint256 serviceFee
);
```

#### 3.1.9 Gas 消耗估算

| 操作 | 预估 Gas |
|------|----------|
| pay()（首次） | ~85,000 |
| pay()（已 approve） | ~65,000 |
| payWithPermit() | ~80,000 |
| swapAndPay() | ~200,000-400,000（取决于 DEX） |

---

## 四、后端服务详设

### 4.1 技术栈

| 组件 | 选型 | 理由 |
|------|------|------|
| Web 框架 | Fastify | 高性能，TypeScript 友好 |
| 数据库 | PostgreSQL | 关系型，事务支持 |
| ORM | Drizzle | 轻量，类型安全 |
| 队列 | BullMQ + Redis | 可靠的任务调度和重试 |
| 链交互 | viem | 类型安全的 EVM 客户端 |

### 4.2 数据库设计（8 张表）

#### merchants

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | `mer_xxxx` |
| name | VARCHAR(255) | 商户名称 |
| email | VARCHAR(255) | 联系邮箱 |
| api_key | VARCHAR(64) UNIQUE | API 认证密钥 |
| api_secret | VARCHAR(128) | API 密钥（签名用） |
| webhook_url | TEXT | 默认 Webhook 地址 |
| webhook_secret | VARCHAR(128) | Webhook HMAC 签名密钥 |
| receiving_addresses | JSONB | `{"ethereum": "0x...", "bsc": "0x..."}` |
| service_fee_bps | INTEGER | 默认 80（0.8%） |
| referrer_id | VARCHAR(32) | 关联渠道商 |
| active | BOOLEAN | 是否启用 |
| created_at / updated_at | TIMESTAMP | 时间戳 |

#### invoices

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | `inv_xxxx` |
| merchant_id | VARCHAR(32) FK | 关联商户 |
| merchant_order_id | VARCHAR(255) | 商户侧订单号 |
| amount | NUMERIC(36,18) | **USD 计价金额** |
| token | VARCHAR(10) | 实际支付 Token（支付时填入） |
| chain | VARCHAR(20) | 实际支付链（支付时填入） |
| status | VARCHAR(20) | created → initiated → confirmed/failed/expired |
| payment_method | VARCHAR(10) | crypto / fiat |
| payer_address | VARCHAR(66) | 付款人地址 |
| tx_hash | VARCHAR(66) | 链上交易哈希 |
| service_fee | NUMERIC(36,18) | 服务费金额 |
| merchant_received | NUMERIC(36,18) | 商户实收金额 |
| referrer_fee | NUMERIC(36,18) | 渠道商费 |
| description | TEXT | 支付描述 |
| metadata | JSONB | 自定义元数据 |
| redirect_url | TEXT | 支付后跳转 URL |
| webhook_url | TEXT | Invoice 级 Webhook 覆盖 |
| expires_at | TIMESTAMP | 30 分钟后过期 |
| confirmed_at | TIMESTAMP | 确认时间 |

**Invoice 状态机**：
```
created → initiated → confirmed
                   ↘ failed
created → expired（30 分钟未支付）
confirmed → refunded（手动退款标记）
```

#### transactions

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(32) PK | `tx_xxxx` |
| invoice_id | VARCHAR(32) FK | 关联 Invoice |
| chain | VARCHAR(20) | 链名称 |
| tx_hash | VARCHAR(66) | 链上交易哈希 |
| block_number | INTEGER | 所在区块 |
| from_address | VARCHAR(66) | 发送方 |
| to_address | VARCHAR(66) | 接收方（PaymentRouter） |
| token | VARCHAR(10) | Token 类型 |
| amount | NUMERIC(36,18) | 金额 |
| status | VARCHAR(20) | pending → confirmed / failed |
| confirmations | INTEGER | 当前确认数 |

#### webhooks / webhook_logs

Webhook 配置和投递记录表，支持多 Webhook 端点和重试日志。

#### subscriptions / referrers / keystores

Phase 2/3 使用，Phase 1 表已建但不使用。

### 4.3 API 设计

#### 4.3.1 认证

所有 `/v1/merchants/*` 和 `/v1/transactions/*` 端点需要 `X-API-Key` 请求头。

Invoice 查询 `GET /v1/invoices/:id` **不需要认证**（SDK 需要在支付页读取 Invoice 信息）。

#### 4.3.2 端点详表

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/v1/merchants` | 无 | 创建商户，返回 apiKey + apiSecret |
| GET | `/v1/merchants/me` | API Key | 查询当前商户信息 |
| PATCH | `/v1/merchants/me` | API Key | 更新商户信息 |
| POST | `/v1/invoices` | API Key | 创建 Invoice（USD 计价） |
| GET | `/v1/invoices/:id` | 无 | 查询 Invoice 状态 |
| POST | `/v1/invoices/:id/tx` | 无 | 提交 txHash（SDK 调用） |
| POST | `/v1/invoices/:id/refund` | API Key | 标记退款 |
| GET | `/v1/transactions` | API Key | 交易明细（分页/筛选） |
| GET | `/v1/transactions/summary` | API Key | 汇总统计 |
| GET | `/v1/transactions/export` | API Key | CSV 导出 |
| GET | `/v1/balances` | API Key | 商户多链余额 |
| GET | `/v1/quotes` | 无 | DEX swap 报价 |
| GET | `/v1/chains/:chain/stablecoins` | 无 | 可用稳定币（过滤脱锚） |

#### 4.3.3 创建 Invoice

**Request**：
```json
POST /v1/invoices
X-API-Key: bp_xxxx

{
  "amountUsd": "10.00",
  "chain": "arbitrum",          // 可选，用户可在支付页改
  "description": "Premium Plan",
  "merchantOrderId": "order-123",
  "metadata": { "plan": "premium" },
  "redirectUrl": "https://example.com/success",
  "webhookUrl": "https://example.com/webhook"
}
```

**Response**：
```json
{
  "id": "inv_abc123",
  "merchantId": "mer_xyz",
  "amount": "10.00",
  "token": "USD",
  "chain": "arbitrum",
  "status": "created",
  "serviceFee": "0.08",
  "merchantReceived": "9.92",
  "expiresAt": "2026-04-10T12:30:00Z",
  "createdAt": "2026-04-10T12:00:00Z"
}
```

#### 4.3.4 提交交易

SDK 在用户签名后调用：

```json
POST /v1/invoices/inv_abc123/tx

{
  "txHash": "0xabcdef...",
  "payerAddress": "0x1234...",
  "toAddress": "0x5678...",     // PaymentRouter 地址
  "chain": "arbitrum",          // 用户实际选择的链
  "token": "USDT"               // 用户实际选择的 Token
}
```

此时 Invoice 状态从 `created` → `initiated`，并触发 `payment.initiated` Webhook。

### 4.4 Webhook 机制

#### 两阶段通知

**阶段 1 — 支付已发起**：
```json
{
  "event": "payment.initiated",
  "invoiceId": "inv_abc123",
  "txHash": "0xabcdef...",
  "chain": "arbitrum",
  "timestamp": "2026-04-10T12:01:00Z"
}
```

**阶段 2 — 链上确认**：
```json
{
  "event": "payment.confirmed",
  "invoiceId": "inv_abc123",
  "merchantOrderId": "order-123",
  "amountUsd": "10.00",
  "token": "USDT",
  "chain": "arbitrum",
  "tokenAmount": "10.00",
  "serviceFee": "0.08",
  "merchantReceived": "9.92",
  "paymentMethod": "crypto",
  "txHash": "0xabcdef...",
  "timestamp": "2026-04-10T12:02:00Z"
}
```

#### 安全

- HMAC-SHA256 签名：`X-ButterPay-Signature` 头
- 签名计算：`hmac_sha256(webhook_secret, JSON.stringify(payload))`
- 商户验签后返回 2xx 确认

#### 重试策略

| 次数 | 延迟 |
|------|------|
| 第 1 次重试 | 10 秒 |
| 第 2 次重试 | 60 秒 |
| 第 3 次重试 | 300 秒 |
| 超过 3 次 | 放弃 |

实现：BullMQ `webhook-retry` 队列，30 秒扫描一次 `webhook_logs` 表中 `next_retry_at` 到期的记录。

### 4.5 Tx Tracker

#### 轮询机制

- BullMQ `tx-tracking` 队列，并发 10
- 每 15 秒扫描 `transactions` 表中 `status = pending` 的记录
- 使用 viem `getTransactionReceipt` 查询链上状态

#### 确认阈值

| 链 | 所需确认数 |
|---|---|
| Ethereum | 12 |
| Arbitrum | 20 |
| BSC | 15 |
| Polygon | 128 |
| Optimism | 20 |

#### 状态转换

```
pending → confirmed（confirmations >= 阈值）
pending → failed（receipt.status === "reverted"）
```

### 4.6 稳定币脱锚保护

- 60 秒轮询 CoinGecko/DeFiLlama 获取 USDT/USDC 价格
- 偏离 > 5% 时标记该 Token 为 depegged
- `GET /v1/chains/:chain/stablecoins` 自动过滤脱锚 Token
- 前端支付页不展示被过滤的 Token

---

## 五、SDK 详设（@butterpay/core）

### 5.1 模块结构

```
sdk/core/src/
├── index.ts              # 统一导出
├── butterpay.ts          # 主入口类 ButterPay
├── api-client.ts         # HTTP API 客户端
├── chains.ts             # 5 链配置（RPC + Token 地址）
├── types.ts              # 类型定义
├── abi/
│   └── index.ts          # ERC20 + PaymentRouter ABI
├── wallets/
│   ├── external-wallet.ts  # EIP-1193 钱包适配器
│   └── hd-wallet.ts        # HD 钱包适配器（Phase 2 使用）
└── providers/
    └── crypto-provider.ts  # 链上支付执行引擎
```

### 5.2 WalletAdapter 接口

```typescript
interface WalletAdapter {
  connect(): Promise<Address>;
  disconnect(): Promise<void>;
  getAddress(): Address | null;
  isConnected(): boolean;
  sendTransaction(tx: TransactionRequest): Promise<Hash>;
  signTypedData?(params: SignTypedDataParams): Promise<Hash>;
  readonly type: "hd" | "walletconnect" | "tonconnect" | "external";
}
```

Phase 1 只使用 `ExternalWalletAdapter`（包装 `window.ethereum`）。

### 5.3 CryptoPaymentProvider

核心支付执行引擎：

| 方法 | 说明 |
|------|------|
| `scanBalances(address)` | 并行扫描 5 链 × 2 Token 的余额 |
| `supportsPermit(tokenAddress)` | 检查 Token 是否在 permit 白名单 |
| `ensureApproval(chain, token, spender, amount)` | 检查 allowance，不足则 approve(maxUint256) |
| `pay(params)` | 稳定币支付：检测 permit → approve → PaymentRouter.pay() |
| `swapAndPay(params)` | 非稳定币支付：approve → PaymentRouter.swapAndPay() |

**Permit 白名单**（已知支持 EIP-2612 的 Token）：
- ETH USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- ARB USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- Polygon USDC: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- OP USDC: `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`

### 5.4 ButterPay 主类

完整支付编排（5 步）：

```typescript
async pay(params): Promise<{ invoice, txHash }> {
  // 1. 创建 Invoice（调 API）
  const invoice = await this.api.createInvoice(...)

  // 2. 计算 bytes32 invoiceId（keccak256）
  const invoiceIdBytes32 = keccak256(toHex(invoice.id))

  // 3. 执行链上支付（CryptoPaymentProvider）
  const result = await this.cryptoProvider.pay(...)

  // 4. 提交 txHash 到后端（开始 tracking）
  await this.api.submitTransaction(...)

  // 5. 可选：轮询等待确认
  if (params.waitForConfirmation) {
    const confirmed = await this.api.waitForConfirmation(invoice.id)
    return { invoice: confirmed, txHash: result.txHash }
  }
}
```

### 5.5 支持链 & Token

| 链 | Chain ID | USDT 地址 | USDC 地址 | 精度 |
|---|---|---|---|---|
| Ethereum | 1 | `0xdAC17F...` | `0xA0b869...` | 6 |
| Arbitrum | 42161 | `0xFd086b...` | `0xaf88d0...` | 6 |
| BSC | 56 | `0x55d398...` | `0x8AC76a...` | 18 |
| Polygon | 137 | `0xc2132D...` | `0x3c499c...` | 6 |
| Optimism | 10 | `0x94b008...` | `0x0b2C63...` | 6 |

---

## 六、Web 前端详设

### 6.1 页面结构

| 路由 | 类型 | 说明 |
|------|------|------|
| `/` | 静态 | 落地页 |
| `/pay/[id]` | 动态 SSR | 托管支付页（核心） |
| `/pay/link` | 静态 CSR | 支付链接页（固定/自定义金额） |
| `/dashboard` | 静态 CSR | 商户 Dashboard |

### 6.2 支付页流程（PaymentFlow 组件）

```
步骤 1: connect   → 连接钱包（window.ethereum / MetaMask）
步骤 2: select    → 扫描 5 链余额 → 展示可用 Token → 用户选择
步骤 3: paying    → 切链 → 检查 allowance → approve（如需）→ pay()
步骤 4: confirming → 提交 txHash 到后端 → 轮询 Invoice 状态
步骤 5: success/failed → 展示结果 → 可跳转 redirectUrl
```

**边界处理**：
- Invoice 过期：展示过期提示
- Invoice 已支付：展示已确认状态
- 钱包未安装：提示安装 MetaMask
- approve 失败：回到 select 步骤
- pay 失败：展示错误，允许重试

### 6.3 Dashboard 功能

| 功能 | 说明 |
|------|------|
| API Key 登录 | 输入 API Key → 验证 → 进入 Dashboard |
| 汇总卡片 | 总交易数 / 总金额 / 总服务费 / 商户实收 |
| 交易列表 | 表格展示，支持按 status 筛选 |
| CSV 导出 | 一键导出交易明细 |
| 退出 | 清除 session，回到登录 |

### 6.4 支付链接页

```
/pay/link?amount=10&description=Premium+Plan&apiKey=bp_xxx

参数：
  amount       — 固定金额（留空则用户自填，适合打赏）
  description  — 显示的描述
  apiKey       — 商户 API Key
  redirect     — 支付后跳转 URL
```

工作流：输入/确认金额 → 调 API 创建 Invoice → 跳转 `/pay/{invoiceId}`。

---

## 七、部署配置

### 7.1 合约部署

```bash
# 设置环境变量
export FEE_COLLECTOR=0x...  # 服务费收集地址

# 部署到目标网络
npx hardhat run scripts/deploy.js --network arbitrum
npx hardhat run scripts/deploy.js --network bsc
npx hardhat run scripts/deploy.js --network polygon
npx hardhat run scripts/deploy.js --network optimism
npx hardhat run scripts/deploy.js --network mainnet
```

每链部署一份 PaymentRouter，地址记录后配置到后端和前端。

### 7.2 后端部署

```bash
# 环境变量
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
PORT=3000
WEBHOOK_SECRET=...
RPC_ARBITRUM=https://...
RPC_BSC=https://...
RPC_POLYGON=https://...
RPC_OPTIMISM=https://...
RPC_ETHEREUM=https://...
```

### 7.3 前端部署

```bash
NEXT_PUBLIC_API_URL=https://api.butterpay.io
```

---

## 八、测试覆盖

### 合约测试（37 个，全部通过）

| 合约 | 测试数 | 覆盖内容 |
|------|--------|---------|
| PaymentRouter | 12 | pay/permit/swap/admin/pause/whitelist |
| Splitter | 7 | 分账/rounding/校验 |
| SubscriptionManager | 12 | 订阅/扣款/取消/过期/admin |
| ButterPayDelegate | 6 | 批量执行/原子回滚/校验 |

### 后端/SDK

TypeScript 严格模式编译通过（`tsc --noEmit`）。

---

## 九、商户接入指南（Phase 1）

```
1. 注册商户
   POST /v1/merchants { "name": "MyStore" }
   → 获得 apiKey

2. 配置 Webhook
   PATCH /v1/merchants/me { "webhookUrl": "https://mystore.com/webhook" }

3. 创建支付订单
   POST /v1/invoices { "amountUsd": "9.99", "merchantOrderId": "order-001" }
   → 获得 invoiceId

4. 引导用户支付
   跳转用户到 https://pay.butterpay.io/pay/{invoiceId}

5. 接收 Webhook 通知
   event: "payment.confirmed" → 发货/开通服务

6. 对账
   GET /v1/transactions?status=confirmed
   GET /v1/transactions/export → CSV 下载
```

---

## 十、已知限制 & TODO

| 项目 | 状态 | 说明 |
|------|------|------|
| DEX 聚合器集成 | TODO | 当前 Quote API 返回 placeholder，需接 1inch/ButterSwap 真实 API |
| PaymentRouter 地址 | TODO | 部署后需更新到 SDK chains.ts 和 web config.ts |
| 商户 Dashboard 余额 | TODO | balance.service.ts 在 Phase 1 分支暂未创建 |
| WalletConnect v2 | TODO | 当前使用 window.ethereum，需集成 AppKit v2 |
| HTTPS/域名 | TODO | 生产环境需配置 SSL + 域名 |
| Rate Limiting | TODO | API 需要限流 |
| 合约审计 | TODO | 主网部署前需外部安全审计 |
