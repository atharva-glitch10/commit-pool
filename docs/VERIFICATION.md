# How CommitPool verifies a check-in

A blockchain can't see anyone sleep or walk. It can only check **who signed a message and when**. Each pool picks how much proof the oracle needs before it signs a check-in. The choice is written into the pool's **on-chain goal text** as a short tag, so it can't be changed after creation and needs no extra storage or contract changes.

| Tier | Goal tag | What proves a day | Status |
|---|---|---|---|
| Basic | *(none)* | Member taps inside the window | **Live** |
| Tier 1 · Wake-up ring | `|t1` | Random ring inside the window; answer a puzzle before it expires; answer signed by the member's wallet | **Live** |
| Tier 2 · Phone health app | `|t2:steps=10000` | Device-recorded steps from Health Connect / Apple Health in the 24 h before the check-in; manual entries ignored; data signed by the member's wallet | **Beta** |
| Tier 3 · Smartwatch | `|t3:sleep=420,by=540` | Sleep recorded by a watch / ring / band, ≥ `sleep` minutes, started ≥ `by` minutes before the check-in deadline; phone-only and manual sleep rejected | **Beta** |

*Live* = works on the website today. *Beta* = oracle rules built and unit-tested; reading the data requires the companion app (`companion/`), which type-checks against the real libraries but has not yet been run on a device.

## Flow

1. The member proves the day as the tier requires.
2. The oracle (`api/_oracle.js`) checks membership, the open window (wall clock), and the tier's rules.
3. It signs `keccak256(chainId, contract, poolId, member, day)` (EIP-191).
4. `CommitPool.submit()` recovers the signer, requires it to equal the immutable `oracle`, and enforces the window with `block.timestamp`.

## Tier 1 details (`api/_challenge.js`)

- **Ring time** = HMAC(oracle-derived secret, pool, member, day) mapped into the window, so it is random per person per day and unknown in advance. Real pools (window ≥ 10 min): 120 s to respond, ending at least 60 s before the window closes. Demo pools: rings when the window opens.
- **Challenge token** is stateless and HMAC-protected; the answer is never in the token (only an HMAC of it), so it can't be read out or brute-forced client-side.
- The member's wallet signs `CommitPool wake-up check / Pool P, day D / Code N / Answer A`.

## Tier 2 / 3 details (`api/_evidence.js`)

Evidence format (produced by `companion/src/evidence.ts`):
```json
{ "v": 1, "poolId": "12", "member": "0x…", "day": 3, "platform": "android", "kind": "steps", "collectedAt": 1800000000,
  "records": [{ "start": 0, "end": 0, "value": 7000, "method": "automatic", "deviceType": "phone", "source": "com.google.android.apps.fitness" }],
  "attestation": { "type": "none" } }
```
- Health Connect mapping, verified against `androidx…/metadata/Device.kt` and `react-native-health-connect` types: `recordingMethod` 1 active, 2 automatic, **3 manual (rejected)**; `device.type` **1 watch**, 2 phone, **4 ring**, **6 band**.
- iOS: `react-native-health`'s daily step totals already exclude user-entered samples (library source). Its sleep samples expose neither a manual flag nor a device type, so Tier 3 on iOS excludes samples whose source is the Health app itself (`com.apple.Health`). **This is a heuristic and weaker than the Android check.**
- Evidence must be collected ≤ 30 min before the check-in, belong to this pool/member/day, and be signed by the member's wallet over a canonical hash (any edit breaks the signature).
- **Device attestation** (Play Integrity / App Attest) is not verified yet; evidence is reported as `unverified`. Set `REQUIRE_DEVICE_ATTESTATION=1` to refuse all evidence until a verifier is configured.

## Tests

- `npm run test:oracle`: 16 tests (tags, window, ring schedule, challenge: wrong answer, expiry, wrong wallet, tampering, other day; steps: manual ignored, stale, out-of-window; sleep: phone-only, manual, too short, too late, iOS stage merging; signature tamper; key normalisation).
- `cd companion && npm test`: 5 tests converting realistic Health Connect / HealthKit records and running them through the real oracle rules.
- Browser end-to-end on a local chain: basic tap, Tier 1 (wrong answer rejected, right answer accepted, payout), Tier 2 (device steps accepted, manual steps rejected).

## Not solved yet

- Basic and Tier 1 prove someone with the member's wallet was awake and responsive, not that they slept.
- Health data is only as honest as the phone until device attestation is enforced.
- A whole pool colluding (they only move their own money).

## Why not the Fitbit API directly?

Google ended support for the legacy Fitbit Web API on 30 September 2026 ([Google Health API reference](https://developers.google.com/health/reference/rest/v4beta/users)); its replacement is not onboarding new projects, and Google Fit APIs are being shut down. Many wearable apps sync into Health Connect / Apple Health, so one integration there covers many devices.
