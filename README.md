# ButterPay

Crypto payment infrastructure. Accept any token, receive stablecoins.

## Architecture

```
contracts/          Solidity smart contracts (Hardhat)
backend/            Payment API (Fastify + PostgreSQL + Redis)
sdk/core/           @butterpay/core - wallet, payment, API client
sdk/react/          @butterpay/react - React components with white-label
sdk/widget/         Lite Widget - zero-code <script> tag embed
web/                Web payment page + Merchant Dashboard (Next.js)
bots/telegram/      Telegram Bot
bots/discord/       Discord Bot
```

## Contracts

| Contract | Description |
|---|---|
| **PaymentRouter** | Unified payment entry: `pay()`, `payWithPermit()`, `swapAndPay()` |
| **ButterPayDelegate** | EIP-7702 batch execute (approve + pay in one tx) |
| **Splitter** | Multi-party split payment |
| **SubscriptionManager** | Recurring subscription with on-chain rules |

## Quick Start

### Contracts

```bash
npm install
npx hardhat compile
npx hardhat test          # 37 tests
npx hardhat run scripts/deploy.js --network <network>
```

### Backend

```bash
cd backend
npm install
cp .env.example .env      # configure DATABASE_URL, REDIS_URL, RPC endpoints
npm run migrate            # create tables
npm run dev                # start dev server on :3000
```

### Web (Payment Page + Dashboard)

```bash
cd web
npm install
npm run dev                # start on :3001
```

- Payment page: `http://localhost:3001/pay/<invoiceId>`
- Payment link: `http://localhost:3001/pay/link?amount=10&description=Tip`
- Dashboard: `http://localhost:3001/dashboard`

### Lite Widget

```html
<div id="butterpay-button"
     data-amount="9.99"
     data-description="Premium Plan"
     data-api-url="https://api.butterpay.io"
     data-api-key="bp_xxx">
</div>
<script src="https://cdn.butterpay.io/widget.js"></script>
```

## API Endpoints

### Phase 1 — Payment Core
```
POST   /v1/merchants              Create merchant
GET    /v1/merchants/me            Get merchant info
POST   /v1/invoices                Create invoice (USD-denominated)
GET    /v1/invoices/:id            Get invoice
POST   /v1/invoices/:id/tx         Submit tx hash for tracking
POST   /v1/invoices/:id/refund     Mark as refunded
GET    /v1/transactions            List transactions
GET    /v1/transactions/summary    Aggregated stats
GET    /v1/transactions/export     CSV export
GET    /v1/balances                Multi-chain balances
GET    /v1/quotes                  DEX swap quote
GET    /v1/chains/:chain/stablecoins  Available stablecoins (depeg filtered)
```

### Phase 2 — Subscriptions + TG
```
POST   /v1/subscriptions           Create subscription
GET    /v1/subscriptions/:id       Get subscription
POST   /v1/subscriptions/:id/cancel Cancel subscription
PUT    /v1/keystores               Upload encrypted keystore
GET    /v1/keystores/:tgUserId     Get keystore
```

### Phase 3 — Fiat + Referral
```
POST   /v1/fiat/pay                Create fiat payment (TrustPay)
POST   /v1/fiat/callback           TrustPay webhook
POST   /v1/referrers               Register as referrer
GET    /v1/referrers/:code         Lookup referrer
```

## Supported Chains

| Chain | Type | Phase |
|---|---|---|
| Ethereum / Arbitrum / BSC / Polygon / Optimism | EVM | 1 |
| Tron | TVM | 2 |
| Solana | SVM | 3 |
| TON | TON Connect | 3 |

## Fee Model

| Fee | Who Pays | Source |
|---|---|---|
| Service fee (0.5-0.8%) | Merchant | Deducted from payment |
| Gas fee | User | Added to payment amount |

## License

MIT
