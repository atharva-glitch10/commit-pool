# CommitPool companion app (beta)

Reads today's steps or last night's sleep from **Health Connect** (Android) or **Apple Health** (iOS) and hands it back to the CommitPool website, where the member signs it with their wallet and the oracle checks it (Tier 2 / Tier 3 pools).

**Status:** type-checks cleanly against the real `react-native-health-connect` 4.1.3 and `react-native-health` 1.19.0 types, and its data conversion passes 5 tests against the real oracle rules. **It has not been run on a device yet.**

## Build (development build; Expo Go cannot load these native modules)

```bash
cd companion
npm install
npm test                 # data-conversion tests (Node 22+)
npm run typecheck
npx expo prebuild
npx expo run:android     # Android phone with Health Connect, minSdk 26
npx expo run:ios         # Mac + Xcode, real iPhone (HealthKit has no simulator data)
```

## How it's used

1. On the website, a Tier 2/3 pool shows **Sync from the CommitPool app** with a QR code / link `commitpool://sync?pool=…&day=…&member=…&kind=steps|sleep&return=…`.
2. The app opens on that pool, asks for read permission, and reads the last 36 hours.
3. **Send to CommitPool** opens the website again with the data attached (`#/pool/<id>?ev=…`). The member signs it with their wallet; the oracle applies the tier's rules.

Nothing is stored on a server. Device attestation (Play Integrity / App Attest) is not wired yet, so the oracle reports the data as *unverified*.
