import { useReadContract } from 'wagmi'
import { EXPLORER, POOL_ADDRESS } from './config'
import { base } from './lib'
import { PoolPanel } from './PoolPage'
import { Feed, Ledger } from './Feed'
import { Dial } from './ui'

function DemoDial() {
  // static illustration used before any pool exists
  const now = 1000, deadline = (d: number) => 900 + d * 100
  return <Dial rings={[{ mask: 0b111, me: false }, { mask: 0b101, me: false }, { mask: 0b011, me: false }]} days={3} now={now} deadline={deadline} win={10} size={300}
    center={<><span className="big">2/3</span><span className="small">kept their word</span></>} />
}

export function Landing() {
  const { data: count } = useReadContract({ ...base, functionName: 'poolCount', query: { refetchInterval: 5000 } })
  const latest = count && count > 0n ? count : null
  return (
    <>
      <section className="hero">
        <div className="pitch">
          <h1>Keep your word, or pay the friends who kept theirs.</h1>
          <p className="lede">Pick a habit, put money on it with friends, and check in every day from your phone. A contract on Monad holds the pot and pays whoever finishes.</p>
          <div className="ctas">
            <a className="btn sun big" href="#/start?next=%2Fnew">Make a pledge</a>
            {latest && <a className="textlink" href={`#/pool/${latest}`}>Watch a live pool</a>}
          </div>
          <p className="hint fine">Free to try on Monad Testnet. Use a passkey or an existing browser wallet. Test MON has no real-world value.</p>
        </div>
        <div className="stage">
          {latest ? <PoolPanel id={latest} compact /> : <div className="pool"><DemoDial /></div>}
          {latest && <p className="stagecap">Pool {latest.toString()}, live from the chain. Each ring is a person, each arc a day.</p>}
        </div>
      </section>

      <section className="band">
        <h2 className="h2">How it works</h2>
        <ol className="steps">
          <li><strong>Lock a stake.</strong> Everyone in the pool puts in the same amount of MON. It sits in the contract; nobody, including us, can take it out early.</li>
          <li><strong>Check in every day.</strong> Tap in the window or answer a timed wake-up challenge. The challenge proves a timely response from the member’s account, not sleep. Health-data pools need the beta companion app. The contract verifies the trusted oracle’s signature.</li>
          <li><strong>Get paid for following through.</strong> When the last day ends, anyone can trigger the payout. People who kept every day split the stakes of those who didn’t.</li>
        </ol>
      </section>

      <section className="band split">
        <div>
          <h2 className="h2">Rules everyone can inspect</h2>
          <dl className="facts">
            <div><dt>No admin key</dt><dd>The oracle, the treasury and the fee are fixed when the contract is deployed. There is no function that moves members’ stakes except the payout rules.</dd></div>
            <div><dt>Check-ins can’t be replayed</dt><dd>Each signature is bound to this chain, this contract, this pool, your address and that one day. Reusing it anywhere else fails.</dd></div>
            <div><dt>Public outcomes, private reflections</dt><dd>Joins, check-ins and payouts are visible on the <a href={`${EXPLORER}/address/${POOL_ADDRESS}`} target="_blank" rel="noreferrer">explorer</a>. Your <a href="#/journal">journal</a> is encrypted with a separate passkey-derived key.</dd></div>
          </dl>
          <p className="hint fine"><a href="#/trust">How each verification tier works, and what isn’t solved yet</a></p>
        </div>
        <div>
          <h2 className="h2">Who pays</h2>
          <div className="receipt example" aria-label="Example settlement">
            <p className="rtitle">Example: three friends, 0.1 MON each, one skips a night</p>
            <dl>
              <div><dt>Locked in the contract</dt><dd>0.3 MON</dd></div>
              <div><dt>Forfeited by the one who skipped</dt><dd>0.1 MON</dd></div>
              <div><dt>Protocol fee, 10% of the forfeit</dt><dd>0.01 MON</dd></div>
              <div className="total"><dt>Each of the two who kept their word gets</dt><dd>0.145 MON</dd></div>
            </dl>
            <p className="hint fine">If everyone finishes, everyone gets their stake back and nobody pays anything.</p>
          </div>
        </div>
      </section>

      <section className="band split">
        <div>
          <h2 className="h2">Right now</h2>
          <Ledger />
          <a className="btn ink" href="#/app">See all pools</a>
        </div>
        <Feed />
      </section>

      <section className="band faq">
        <h2 className="h2">Questions people ask</h2>
        <details><summary>How do you know I really did it?</summary><p>Each pool picks a verification tier. Basic is a tap inside the window. Tier 1 rings at a random moment you can’t predict, and you answer within the time limit and sign it with your wallet. Tiers 2 and 3 (in beta) read device-recorded steps or watch-recorded sleep from Health Connect or Apple Health through the CommitPool app, and manually entered data doesn’t count. <a href="#/trust">Read exactly how it works</a>, including what isn’t solved yet.</p></details>
        <details><summary>Can the app take my money?</summary><p>No. The contract has no admin functions. Stakes can only leave through the payout rules: to the people who finished, as refunds, or the 10% fee on forfeited stakes.</p></details>
        <details><summary>Why use a blockchain for this?</summary><p>So nobody has to trust a company to hold the pot or judge who won. And because every daily check-in is a transaction, it needs a chain that is fast and cheap, which is why it runs on Monad.</p></details>
        <details><summary>Why are the days 60 seconds long?</summary><p>So a whole challenge fits into a demo. Real pools use 24-hour days with a one-hour check-in window.</p></details>
      </section>
    </>
  )
}
