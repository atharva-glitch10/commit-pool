# Metropolis implementation and deployment

## What changed

- Mera 0.2.0 is a real wagmi connector alongside injected wallets. Both use the existing Monad Testnet contract; this change does not redeploy escrow or the oracle.
- Wallet keys use `SHA-256("commitpool.wallet.v1")` as the PRF salt. The 32 bytes back a secp256k1 Mera signing session and its official viem adapter. This is a versioned account derivation, not a BIP-39 wallet import.
- Signing sessions remain in memory for at most 15 minutes and end on disconnect. Each message/transaction displays an application confirmation, not a fresh biometric prompt. Transaction signing is restricted to the configured CommitPool contract on chain 10143. Refresh requires unlocking again.
- The journal uses `SHA-256("commitpool.journal.v1")` with the **same pinned passkey**, producing separate encryption material. AES-GCM uses a fresh 12-byte nonce for every write, a non-exportable CryptoKey, and account/origin/entry-ID authenticated context. Raw PRF bytes are wiped after import. Journals lock within five minutes and clear plaintext on account change/disconnect.
- Local mode stores ciphertext only. Cloud mode stores ciphertext in Upstash and requires a one-use wallet signature for each list/save/delete. Signatures bind account, configured origin, operation, payload hash, nonce and five-minute expiry. Atomic nonce consumption prevents replay. No encryption key is uploaded.
- Envio projects public pool events into pool, membership and activity entities. Dashboard/leaderboard use GraphQL when configured and recent pools are present, with RPC fallback otherwise. Pool actions use current contract reads. A payout panel links to pools with an apparently unclaimed payout.

## Account and privacy limits

Use `http://localhost:5173` locally, not an IP-address URL. Production requires HTTPS on a stable domain. Passkeys bind the hostname; journal encryption additionally binds the full origin. Moving domains or ports does not automatically recover old entries.

Recover with the existing passkey; creating another passkey creates another account and keys. Synced credentials can recover on compatible devices at the same origin. Losing the passkey can lose account and journal access. Clearing browser storage loses local entries without a backup. Export/restore supports the same account and origin; restore merges locally without cloud upload. Local/cloud modes are separate; cloud saves also cache an encrypted local copy.

Cloud storage learns account addresses, entry IDs, ciphertext sizes and access times. Goals, membership and check-ins remain public on-chain. Journals are not sent to the oracle. The health verifier still sees submitted health evidence; this change does not add hardware attestation or a decentralized/private oracle.

Unlocked keys live in page memory. Browser script compromise can expose unlocked data or signing capability. This is an unaudited hackathon prototype: testnet only.

## Local setup

1. Node 24+, then `npm ci`.
2. Copy `.env.example` to `.env.local`; never put credentials in the example or commit the local file.
3. `npm run dev`, then `http://localhost:5173`.
4. Mera needs no API key. PRF support varies by browser/authenticator. Existing wallets remain available; journals require Mera.
5. Accounts need test MON for stakes/gas. The app links to the faucet; no gas sponsorship is claimed.

## Cloud journal settings

Create an Upstash Redis database. Set these in ignored `.env.local` or Vercel's **server-side** environment variables:

```
UPSTASH_REDIS_REST_URL=<database REST URL>
UPSTASH_REDIS_REST_TOKEN=<write-capable REST token>
JOURNAL_ORIGIN=https://<stable-app-domain>
```

Local origin is `http://localhost:5173`; use the exact origin without a trailing slash. Preview deployments need their own matching origin. Never prefix tokens or the oracle key with `VITE_`.

Storage needs GETDEL and EVAL, so a read-only token is insufficient. Limits: 100 entries/account, approximately 4,000 characters/entry, 20 challenge requests/account/minute. There is no global/DDoS limiter; use hosting/provider protection for a larger public launch. Entries have no TTL; authorization nonces expire after five minutes.

## Vercel deployment (project owner)

1. Deploy this branch as a preview. Build: `npm run build`; output: `dist`; Node: 24.x.
2. Preserve the existing server `ORACLE_PRIVATE_KEY`; it must match the deployed contract's `oracle()`. Never paste it into GitHub or chat.
3. Set the three journal variables for the target environment and redeploy.
4. Actually save/list/delete a journal entry: configured status alone does not prove Redis access works.
5. Test passkey creation/recovery, signed challenges and a contract transaction on a real phone. Virtual-authenticator tests do not replace this.
6. Pick the stable production domain before enrolling users. Preview credentials differ from production credentials.

## Envio deployment (Linux/WSL or Envio Cloud)

The CLI does not run natively on Windows. In `indexer/`: `npm install`, `npm run codegen`, `npm test`, then `npm run dev` on a supported host. Deploy with Envio Cloud from this repository, selecting `indexer` as project directory.

Start block 0 enables historical backfill; do not switch to `latest`, because projections need original creation events. If redeploying the pool, update the indexer address and `VITE_POOL_ADDRESS` together. Set `VITE_ENVIO_URL` to the public read-only GraphQL endpoint, never an admin credential, then rebuild.

The query expects generated Hasura `Pool` and `Membership` tables with numeric BigInt fields. Validate that endpoint after deployment: creator membership, new pool, check-in, settlement and claim should agree with the explorer. Linux CI has passed codegen, handler loading and projection tests. A live GraphQL endpoint and historical indexing have not yet been deployed or verified.

## Validation

```
npm test
npm run build
npm run lint
npx playwright install chromium
npm run test:browser
```

Browser tests use Chromium's virtual PRF authenticator and mocked networks. Node tests cover encryption authentication/recovery, owner/origin binding, signature replay/action substitution/account isolation, and event projections. Run `forge test` separately where Foundry is installed; contract source is unchanged.

Validation performed on 12 October 2026: 27 Node tests, four browser tests, build and lint passed locally; app and indexer jobs passed on GitHub's Linux runners. A live Upstash smoke test using a disposable synthetic account passed encrypted save/list/recovery/delete and replay rejection, with its entry removed afterward. This does not replace real-phone testing, and the exposed REST token must still be rotated before release.

## Submission evidence

- Show actual passkey-authorized contract transactions and explorer receipts.
- Encrypt a reflection, inspect ciphertext, refresh/unlock and recover the text.
- Demonstrate invalid challenge rejection and valid check-in acceptance.
- For Envio, show a live endpoint and product screen using indexed data; don't call unit tests a deployment.
- Disclose Blitz Pune on 10 October 2026 and the fifth-place award, retaining history and identifying subsequent work. AI assistance was used for implementation/tests; describe actual team review.
- Confirm detailed bounty criteria/stacking in the portal. Account UX and separate encryption are candidate integrations, not a qualification/prize guarantee.
- Separate real-duration pilot results from compressed demo days; update old videos.

## Exposed credentials

Accidentally committed environment credentials were removed from the current main tree, but remain in history. Revoke exposed Upstash tokens by resetting the database password in its console, then save the replacement REST token locally and in Vercel. An exposed oracle key would require a new oracle/contract because its signer is immutable. No oracle key was found in the supplied remote config files.
