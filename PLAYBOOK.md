# CommitPool: team playbook for Monad Blitz Pune V3

Code freeze **5:30 PM** · Submission **5:45 PM** · Demo **3 minutes**

## Timeline (do it in this order)

| Time | Who | What |
|---|---|---|
| now–12:30 | P1 | Steps 1–3: GitHub repo, wallets, deploy contract in Remix |
| now–12:30 | P2 | Post #1 on X (below). Start a screenshot folder |
| 12:30–1:00 | P1 | Step 4: Vercel deploy. Test the live URL on a phone |
| 1:00–2:00 | all | Lunch. P2 posts #2 (contract on explorer) |
| 2:00–3:30 | P1+P3 | Step 5: run 2–3 full test pools on the live site with 3 MetaMask profiles; one is the "finished pool" you show in the demo. Fill in README links |
| 3:30–4:30 | P3 | Rehearse the pitch 3× with a timer. P2 posts #3 (video) |
| 4:30–5:15 | all | Final README check, post #4, collect view counts/screenshots |
| **5:30** | | **Code freeze**: last `git push` before this |
| **5:45** | | **Submit on the event portal** with all links + evidence |

---

## Step 1: Repo
1. Create a **new public** GitHub repo `commit-pool`.
2. Upload the contents of the zip (drag-and-drop works: "Add file → Upload files"). Do **not** upload `.env.local` or `node_modules` (they aren't in the zip anyway).

## Step 2: Wallets (MetaMask)
You need 3 addresses. Make them all inside MetaMask ("Add account"):

| Name | Purpose |
|---|---|
| **Deployer/Treasury** | your wallet with MON. Deploys the contract and receives fees |
| **Oracle** | a NEW empty account. Its **private key** goes into Vercel (MetaMask → account ⋮ → Account details → Show private key). Never put real funds in it |
| **Friend B, Friend C** | demo members. Send each ~1 MON from the deployer |

Monad Testnet in MetaMask: RPC `https://testnet-rpc.monad.xyz`, chain ID `10143`, symbol `MON`, explorer `https://testnet.monadvision.com`.

## Step 3: Deploy the contract (Remix, no installs)
1. Open https://remix.ethereum.org → new file `CommitPool.sol` → paste `contracts/src/CommitPool.sol`.
2. **Solidity Compiler** tab: version **0.8.28**. Under *Advanced configurations*, set EVM version **cancun** and enable the optimizer (200). Compile.
3. **Deploy & Run** tab: Environment **"Injected Provider – MetaMask"**, with MetaMask on Monad Testnet and the **Deployer** account selected.
4. Constructor arguments:
   - `oracle_` = **Oracle** address
   - `treasury_` = **Deployer/Treasury** address
   - `feeBps_` = `1000` (10%)
5. Deploy → confirm in MetaMask → copy the contract address under "Deployed Contracts".
6. Open `https://testnet.monadvision.com/address/<address>`. You should see it. **Screenshot it** (post #2).
7. Optional but recommended: verify the source on the explorer (Monad docs → "Verify a contract"). Judges like readable contracts.

**Mainnet bonus:** if your 50 MON is on **mainnet**, repeat step 3 on Monad Mainnet, using a small stake, and say so in the pitch. The app stays on testnet; the mainnet deployment is proof it runs there. Ask the organizers how the mainnet bonus is scored before spending time on it.

## Step 4: Host on Vercel
1. vercel.com → Add New Project → import the GitHub repo. The framework is auto-detected as **Vite**.
2. **Environment Variables:**
   - `VITE_POOL_ADDRESS` = contract address
   - `ORACLE_PRIVATE_KEY` = oracle account's private key (starts with `0x`)
3. Deploy. Open the URL, connect MetaMask, create a pool.
4. If "Verify with device" errors with "Oracle key does not match contract oracle", the key in Vercel isn't the private key of the `oracle_` address you deployed with.
5. If `/api/attest` returns 404, tell Claude immediately. That's a hosting issue, fixable in minutes.

## Step 5: Test and prepare the demo pool
Use 3 browser profiles (or 3 browsers), each with MetaMask holding a different account.
- Create a pool: *Live demo 60 s*, 3 days, starting in 2 min, stake 0.1.
- Others join from the share link → each day click **Verify with device** in the window → one person skips day 2 → settle → claim.
- Keep that pool's ID. It's the **finished pool** you open in the demo to show the payout and fee.

---

## The 3-minute pitch (rehearse with a timer)

**0:00–0:20 Problem**
"Most people who try to fix their sleep quit within weeks. Quitting is free and nobody checks. We fixed both."

**0:20–1:50 Live demo** (the core; judges want to see it running)
1. Open the live URL. Point at the stats bar: pools, total staked, **protocol revenue**.
2. Open the **pre-run pool**: "3 friends, 3 days. This one missed day 2. The contract paid the finishers, and the protocol took 10% of the forfeited stake only."
3. **Live:** a pool created ~2 minutes before your slot (do it while the previous team presents). Click **Verify with device** → MetaMask → it lands. Point at the **"confirmed in X s"** and the **Live on Monad** feed.

**1:50–2:30 How it works / why Monad**
"The phone gets an attestation from our device oracle, and the contract verifies the signature on-chain. No friend vouching, so no collusion. Every daily check-in is a real transaction, which is only practical on a chain this fast and cheap. No admin key: the oracle, treasury and fee are immutable. 18 tests, including a fuzz test proving every wei is accounted for."

**2:30–2:50 Business**
"We earn only when users fail: a fee on forfeited stakes. Winners pay nothing. Next: real wearable data (Apple Health, Google Fit), then B2B wellness programs."

**2:50–3:00 Say these out loud** (100 basic points depend on it):
"Repo: github.com/___/commit-pool. Contract: 0x___ on **Monad Testnet**. Live at ___.vercel.app."

**Honesty lines** (say them if asked; judges respect them): "The device oracle is mocked for today. A day is 60 seconds for the demo. Not audited."

**Backup if Wi-Fi or the live demo dies:** screenshots of every step plus the finished pool's explorer links in a folder, open in tabs before you start.

---

## Build in Public (worth 100 points, as much as the working product)
Post on **X** (and LinkedIn if you have time). Tag **@monad** and **@monad_dev**, and use the event hashtag the organizers give you. Posts after 5:45 PM don't count. Keep a list of every post link and its **view count** (screenshot the counts at ~5:30).

**#1 (now)**
> Building at #MonadBlitz Pune 🌙 Team ___ is making CommitPool: stake money on your habits (sleep, screen time, steps), your phone proves you did it, and a smart contract on @monad pays the people who follow through. 6 hours. Let's go 🚀

**#2 (contract deployed, add explorer screenshot)**
> CommitPool contract is live on @monad testnet ✅ No admin key. The oracle, treasury and fee are immutable, so nobody (including us) can touch your stake. 18 tests + fuzzing for money conservation. 0x___

**#3 (screen recording, 20–40 s, of the live check-in + feed)**
> Check-in → on-chain in seconds. Every daily habit check-in is a real transaction on @monad. Watch the live feed 👇 #MonadBlitz

**#4 (before 5:30, the payout screenshot)**
> Day 3 done. 2 friends finished, 1 skipped a day. The contract paid the finishers automatically and took 10% of the forfeit, only from the person who quit. That's the whole business model. Try it: ___.vercel.app @monad #MonadBlitz

Ask each teammate to repost and quote, since views count. Short videos get far more views than text.

---

## Final submission checklist (5:45 PM hard deadline)
- [ ] Public GitHub repo with README containing: project name, one-line description, setup instructions, **live URL, contract address, network** (fill in the top table of README.md)
- [ ] Live URL works on a phone
- [ ] Contract visible on the explorer
- [ ] All posts made **before 5:45**, links + view-count screenshots collected
- [ ] Submitted via the Pune V3 event portal ("Submit Project" tab)
- [ ] Last push before **5:30**, no changes after
- [ ] Pitch rehearsed under 3:00, ending with repo + contract + URL + network said out loud
