import { EXPLORER, POOL_ADDRESS } from './config'

/** #/trust — how check-ins are verified, tier by tier, with honest status. */
export function Verification() {
  return (
    <div className="trust">
      <section className="trusthead">
        <h1 className="h2">How a check-in is verified</h1>
        <p className="lede">
          A blockchain can’t see you sleep or walk. It can only check who signed a message and when. So every pool picks how
          much proof the oracle needs before it signs a check-in. The choice is written into the pool on-chain and can’t be changed later.
        </p>
      </section>

      <section className="band">
        <h2 className="h3 flush">Three tiers, plus a basic mode</h2>
        <table className="levels">
          <thead><tr><th scope="col">Tier</th><th scope="col">What proves a day</th><th scope="col">What it stops</th><th scope="col">Status</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Basic</strong></td>
              <td>A tap inside the check-in window.</td>
              <td>Late check-ins, and anyone checking in for you.</td>
              <td><span className="pill live">Live</span></td>
            </tr>
            <tr>
              <td><strong>Tier 1 · Wake-up ring</strong></td>
              <td>The oracle rings at a random moment inside the window that nobody knows in advance. You answer a quick question within the time limit and sign the answer with your wallet.</td>
              <td>Setting an alarm for one exact minute and going back to sleep, scripted check-ins, and someone else answering without your wallet.</td>
              <td><span className="pill live">Live</span></td>
            </tr>
            <tr>
              <td><strong>Tier 2 · Phone health app</strong></td>
              <td>Steps recorded by your phone or watch, read from Health Connect or Apple Health by the CommitPool app and signed by your wallet.</td>
              <td>Typing steps in by hand: manually entered records are ignored.</td>
              <td><span className="pill">Beta</span></td>
            </tr>
            <tr>
              <td><strong>Tier 3 · Smartwatch</strong></td>
              <td>Sleep recorded by a watch, ring or band: started before your bedtime and lasting at least your goal.</td>
              <td>Claiming sleep you didn’t get. Phone-only and manually entered sleep don’t count.</td>
              <td><span className="pill">Beta</span></td>
            </tr>
          </tbody>
        </table>
        <p className="hint fine">
          Live: works on this site today. Beta: the oracle rules are built and tested; reading the data needs the CommitPool companion app,
          which is in testing and not yet in the app stores.
        </p>
      </section>

      <section className="band">
        <h2 className="h3 flush">What happens when you check in</h2>
        <ol className="flow">
          <li><strong>You prove the day</strong> with whatever your pool’s tier asks for.</li>
          <li><strong>The oracle checks it:</strong> you’re a member, the window is open, and the tier’s rules pass.</li>
          <li><strong>It signs one statement:</strong> this wallet kept day N of pool P, on this chain and this contract.</li>
          <li><strong>The contract verifies the signature</strong> and the time window itself, then marks the day as kept.</li>
        </ol>
        <div className="pipeline" aria-label="Verification pipeline for health data">
          <div><b>Wearable or phone</b><span>records steps or sleep</span></div>
          <div><b>Health Connect / Apple Health</b><span>on your phone</span></div>
          <div><b>CommitPool app</b><span>reads it, you send it to the site</span></div>
          <div><b>Oracle</b><span>applies the tier’s rules, then signs</span></div>
          <div><b>Contract on Monad</b><span>verifies the signature, marks the day</span></div>
        </div>
      </section>

      <section className="band split">
        <div>
          <h2 className="h3 flush">Already impossible to fake</h2>
          <ul className="ticks">
            <li><strong>Nobody can check in for you.</strong> The signature names your wallet, and only your wallet can submit it.</li>
            <li><strong>No reusing a check-in.</strong> It is bound to one pool and one day; replaying it anywhere else fails.</li>
            <li><strong>No late check-ins.</strong> The contract enforces the window with the block time, not the app.</li>
            <li><strong>No editing your health data.</strong> Your wallet signs the exact data; change one number and the signature fails.</li>
            <li><strong>Nobody can take the pot.</strong> There is no admin function. The oracle can mark a day, never move money.</li>
          </ul>
        </div>
        <div>
          <h2 className="h3 flush">Not solved yet</h2>
          <ul className="crosses">
            <li>Basic and Tier 1 prove someone with your wallet was awake and responsive, not that you slept.</li>
            <li>Health data is only as honest as the phone. Device attestation (Play Integrity, App Attest), which proves the data came from the genuine app on a real phone, is not switched on yet.</li>
            <li>On iPhone, sleep samples don’t say whether they were typed in, so Tier 3 there excludes data written by the Health app itself. That check is weaker than on Android.</li>
            <li>A whole pool agreeing to cheat. They only move their own money, but it is possible.</li>
          </ul>
        </div>
      </section>

      <section className="band split">
        <div>
          <h2 className="h3 flush">Next</h2>
          <ul className="plan">
            <li><strong>Device attestation</strong> required for Tier 2 and 3 pools.</li>
            <li><strong>Challenge window:</strong> a pool-mate disputes a check-in by posting a small bond; whoever is wrong pays.</li>
            <li><strong>Stake limits</strong> that grow with a verified streak.</li>
          </ul>
        </div>
        <div>
          <h2 className="h3 flush">Why not plug into Fitbit directly?</h2>
          <p className="narrow">
            Google ended support for the legacy Fitbit Web API on 30 September 2026, its replacement is not taking new projects yet,
            and the Google Fit API is being shut down. Many wearable apps, such as Fitbit and Samsung Health on Android and Apple Watch on
            iPhone, can sync into Health Connect or Apple Health, so reading those covers many devices through one integration.
          </p>
        </div>
      </section>

      <p className="hint fine trustfoot">
        Contract: <a href={`${EXPLORER}/address/${POOL_ADDRESS}`} target="_blank" rel="noreferrer">{POOL_ADDRESS}</a>, source verified on Sourcify.
        Oracle rules: <code>api/_tiers.js</code>, <code>api/_challenge.js</code>, <code>api/_evidence.js</code>, with tests in <code>api/_oracle.test.mjs</code>.
      </p>
    </div>
  )
}
