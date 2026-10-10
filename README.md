# CommitPool

Device-verified commitment pools on Monad. Participants stake funds on a recurring habit, prove completion with signed device attestations, and complete-all-days members split the stakes forfeited by those who did not.

Built for Monad Blitz Pune V3 (10 October 2026), idea-board track: *Commitment contracts and accountability pools*.

| | |
|---|---|
| **Status** | Prototype, testnet only, unaudited |
| **Network** | Monad Testnet (chain ID `10143`) |
| **Contract** | [`0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4`](https://testnet.monadvision.com/address/0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4) |
| **Application** | `https://YOUR-APP.vercel.app` (to be added after deployment) |
| **License** | MIT |

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [Configuration](#configuration)
5. [Smart Contract](#smart-contract)
6. [Oracle API](#oracle-api)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Security](#security)
10. [Known Limitations](#known-limitations)
11. [Roadmap](#roadmap)
12. [Contributing](#contributing)
13. [License](#license)

## Overview

### Problem

Habit change fails largely because quitting is free and unverified. Existing commitment products depend on a custodian that holds funds and adjudicates outcomes, or on peer vouching, which is easily gamed.

### Solution

CommitPool replaces both with an on-chain escrow and a signed device attestation:

1. **Create.** A creator defines a goal, a per-member stake, a start time, a day length and a number of days. Other members join by staking the same amount.
2. **Verify.** Each day, within a short window, a member obtains a signature from the device oracle over `(chainId, contract, poolId, member, day)` and submits it on-chain. The contract validates it with `ecrecover`.
3. **Settle.** After the final window, any account may settle the pool. Members who verified every day claim their stake plus an equal share of the forfeited stakes, net of the protocol fee.

### Payout rules

For `n` members, `w` members who completed all days, stake `s` and fee `f` in basis points:

| Quantity | Formula |
|---|---|
| Forfeited amount | `s × (n − w)` |
| Protocol fee | `forfeited × f / 10000` |
| Winner payout | `s + (forfeited − fee) / w` |

- If `w = 0`, the whole pot is treated as forfeited; the fee is deducted and the remainder is refunded equally.
- Rounding remainders are credited to the treasury, so total payouts plus fees always equal total stakes.
- Pools with fewer than two members after the join deadline can be cancelled; all stakes are refunded in full.

### Pool lifecycle

```
createPool ─► joinPool (until startTime − window)
                  │
      ┌───────────┴───────────┐
  < 2 members             ≥ 2 members
      │                       │
cancelUnderfilled      submit (once per day, inside window)
      │                       │
 claim (refund)         settle (after final window)
                              │
                        claim · withdrawFees
```

### Business model

The protocol charges a fee **only on forfeited stakes**: 10% at deployment, capped at 20% in the contract. Members who complete the commitment pay nothing. Fees can be withdrawn only to a treasury address fixed at deployment.

## Architecture

```
┌─────────────────┐  POST /api/attest   ┌──────────────────────┐
│  Web client     │ ──────────────────► │  Oracle service      │
│  React · wagmi  │ ◄────────────────── │  (serverless)        │
└────────┬────────┘   signature         └──────────┬───────────┘
         │                                         │ read pool state
         │ submit(poolId, signature)               │
         ▼                                         ▼
┌────────────────────────────────────────────────────────────────┐
│                CommitPool.sol · Monad Testnet                  │
└────────────────────────────────────────────────────────────────┘
```

| Component | Technology |
|---|---|
| Smart contract | Solidity 0.8.28, no external dependencies |
| Contract tooling | Foundry |
| Client | React 19, TypeScript, Vite 8, wagmi 3, viem 2 |
| Oracle | Node.js serverless function (Vercel) using viem |

The oracle core (`api/_oracle.js`) is shared by the production function and the Vite dev server, so local and deployed behaviour are identical.

### Repository layout

```
.
├── api/
│   ├── attest.js              Serverless handler for POST /api/attest
│   └── _oracle.js             Oracle logic (shared with dev server)
├── contracts/
│   ├── src/CommitPool.sol     Contract
│   ├── test/CommitPool.t.sol  Foundry test suite
│   ├── script/Deploy.s.sol    Deployment script
│   └── scripts/demo-pool.sh   Demo pool runner
├── src/                       React application
├── .env.example               Environment template
└── vite.config.ts             Build config and dev oracle middleware
```

## Getting Started

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20 or later | With npm |
| EVM browser wallet | e.g. MetaMask |
| Monad Testnet MON | From a public faucet |
| Foundry | Only required for contract development |

### Installation

```bash
git clone <repository-url> commit-pool
cd commit-pool
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
```

Set `ORACLE_PRIVATE_KEY` in `.env.local` (see [Configuration](#configuration)).

### Run locally

```bash
npm run dev
```

The application is served at `http://localhost:5173`, with the oracle available at `/api/attest`.

### Wallet network settings

| Field | Value |
|---|---|
| Network name | Monad Testnet |
| RPC URL | `https://testnet-rpc.monad.xyz` |
| Chain ID | `10143` |
| Currency | `MON` |
| Block explorer | `https://testnet.monadvision.com` |

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server (client and oracle) |
| `npm run build` | Type-check and production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |

## Configuration

| Variable | Scope | Required | Description |
|---|---|---|---|
| `ORACLE_PRIVATE_KEY` | Server only | For check-ins | Private key of the address configured as `oracle` in the contract. Must never be exposed to the client or committed. |
| `VITE_POOL_ADDRESS` | Client and server | No | Contract address. Defaults to the deployment listed above. |
| `VITE_RPC_URL` | Client and server | No | RPC endpoint. Defaults to `https://testnet-rpc.monad.xyz`. |

If the configured key does not correspond to the contract's `oracle` address, `/api/attest` responds with `Oracle key does not match contract oracle`.

## Smart Contract

Source: `contracts/src/CommitPool.sol` (Solidity 0.8.28, MIT).

### Parameters

| Name | Value | Description |
|---|---|---|
| `MIN_MEMBERS` | 2 | Minimum members for an active pool |
| `MAX_MEMBERS` | 20 | Maximum members per pool |
| `MAX_DAYS` | 30 | Maximum pool duration |
| `MIN_DAY_LENGTH` | 60 s | Shortest permitted day |
| `MAX_FEE_BPS` | 2000 | Fee cap (20%) |
| `oracle`, `treasury`, `feeBps` | Set at deployment | `immutable` |

### External functions

| Function | Description |
|---|---|
| `createPool(goal, stake, startTime, dayLength, window, numDays, maxMembers)` | Payable. Creates a pool and enrols the caller. `msg.value` must equal `stake`. Goal length 1–80 bytes. |
| `joinPool(poolId)` | Payable. Enrol before `startTime − window` with exactly the pool stake. |
| `submit(poolId, sig)` | Submit the oracle signature for the currently open day. |
| `cancelUnderfilled(poolId)` | Cancel a pool with fewer than two members after the join deadline. |
| `settle(poolId)` | Compute winners and payouts once the final window has closed. Permissionless, single use. |
| `claim(poolId)` | Withdraw a payout or refund. Once per member. |
| `withdrawFees()` | Transfer accrued fees to the treasury. Permissionless. |

### Views and events

- **Views:** `pools`, `memberState`, `getMembers`, `openDay`, `deadlineOf`, `joinDeadline`, `endTime`, `attestationHash`, `poolCount`, `totalStaked`, `feesAccrued`
- **Events:** `PoolCreated`, `Joined`, `DayVerified`, `PoolCancelled`, `PoolSettled`, `Claimed`, `FeesWithdrawn`

### Timing

For day `d`, the deadline is `startTime + d × dayLength`. Submissions are accepted between `deadline − window` and `deadline + window`. Constraints: `dayLength ≥ 60` and `2 × window < dayLength`.

## Oracle API

### `POST /api/attest`

Request body:

```json
{ "poolId": 1, "member": "0x…", "device": {} }
```

| Status | Meaning |
|---|---|
| `200` | `{ "signature": "0x…", "day": 0, "device": null }` |
| `400` | Invalid `poolId` or `member` |
| `403` | Address is not a member of the pool |
| `409` | No open window, or the day is already verified |
| `500` | Oracle not configured, or key mismatch |

The signature is an EIP-191 `personal_sign` over `attestationHash(poolId, member, day)`.

## Testing

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge test -vv
```

The suite contains 18 tests, including a 256-run fuzz test asserting conservation of funds (payouts plus fees equal stakes). Coverage includes:

- forged, replayed and cross-account signatures
- window boundary conditions
- duplicate submit, claim and settle attempts
- refunds for under-filled pools
- fee cap enforcement
- rounding remainders

The client is validated with `npm run build` (strict TypeScript check and production bundle).

## Deployment

### Contract

```bash
cd contracts
ORACLE=0x<oracle-address> TREASURY=0x<treasury-address> FEE_BPS=1000 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key "$DEPLOYER_KEY" --broadcast
```

Set `VITE_POOL_ADDRESS` to the resulting address.

### Application (Vercel)

1. Import the repository and select the Vite framework preset.
2. Define `ORACLE_PRIVATE_KEY` (and `VITE_POOL_ADDRESS` if redeployed) as environment variables.
3. Deploy. `api/attest.js` is provisioned automatically as a serverless function.

### Demo data

`contracts/scripts/demo-pool.sh` runs a complete three-day pool across three funded testnet wallets: two complete every day and one misses day 2, demonstrating a forfeiture and payout.

```bash
export RPC=https://testnet-rpc.monad.xyz
export POOL=0x<contract-address>
export ORACLE_KEY=0x<oracle-key>
export PK_A=0x<key> PK_B=0x<key> PK_C=0x<key>
bash contracts/scripts/demo-pool.sh
```

Optional overrides: `DAY` (60), `WINDOW` (20), `DAYS` (3), `STAKE` (wei; default 0.05 MON).

## Security

- **No custodial control.** `oracle`, `treasury` and `feeBps` are immutable; no function can move member stakes.
- **Replay resistance.** Attestations are bound to chain ID, contract, pool, member and day, and each day can be recorded once.
- **Signature malleability.** Signatures with upper-half `s` values are rejected.
- **Pull-based payouts.** Each member withdraws individually; a failing recipient cannot block others.
- **Permissionless settlement.** No party can withhold a payout by declining to settle.
- **Trust assumption.** The oracle key holder determines what counts as verified.

This software has not been audited. Do not use it with real funds.

### Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers rather than opening a public issue.

## Known Limitations

- The device oracle is a mock. It confirms membership and window state, then signs; it does not validate real device data.
- Demo pools use 60-second days. A production configuration would use 24-hour days with a window of about one hour.
- A single oracle key is used and cannot be rotated without redeploying.
- Deployed to testnet only.

## Roadmap

- Wearable and health-API integrations (Apple Health, Google Fit, Oura)
- Multi-oracle or threshold attestation with key rotation
- Recurring pools and invitation links
- Mobile PWA with reminders
- Independent security audit

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request. Before submitting:

- run `npm run lint` and `npm run build`
- run `forge test` for any contract change
- keep changes focused and include tests for behavioural changes

## License

Released under the MIT License. See `LICENSE`.
