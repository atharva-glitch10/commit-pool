// CommitPool companion app: reads today's steps or last night's sleep from the phone's health store
// (Health Connect on Android, Apple Health on iOS) and hands it back to the CommitPool website, where the
// member signs it with their wallet and the oracle checks it against the pool's rules.
//
// Status: type-checked against the real library types; NOT yet run on a device. Needs a development build
// (not Expo Go): `npx expo prebuild && npx expo run:android` (or run:ios on a Mac).
import { useEffect, useState } from 'react'
import { Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as ExpoLinking from 'expo-linking'
import { initialize, readRecords, requestPermission } from 'react-native-health-connect'
import AppleHealthKit, { type HealthKitPermissions, type HealthValue } from 'react-native-health'
import {
  buildEvidence, fromHealthConnect, fromHealthKitSleep, fromHealthKitSteps, parseSyncUrl, returnLink,
  type EvidenceRecord, type HcSleep, type HcSteps, type HkSleep, type HkSteps, type SyncRequest,
} from './src/evidence'

const LOOKBACK_H = 36 // covers "today" for steps and "last night" for sleep

async function readAndroid(kind: 'steps' | 'sleep'): Promise<EvidenceRecord[]> {
  const ok = await initialize()
  if (!ok) throw new Error('Health Connect is not available on this phone. Install or update it from the Play Store.')
  const recordType = kind === 'steps' ? 'Steps' : 'SleepSession'
  const granted = await requestPermission([{ accessType: 'read', recordType }])
  if (!granted.some((g) => 'recordType' in g && g.recordType === recordType)) throw new Error('Permission to read your health data was not granted.')
  const endTime = new Date().toISOString()
  const startTime = new Date(Date.now() - LOOKBACK_H * 3600_000).toISOString()
  const res = await readRecords(recordType, { timeRangeFilter: { operator: 'between', startTime, endTime } })
  return fromHealthConnect(kind, res.records as unknown as (HcSteps | HcSleep)[])
}

function readIos(kind: 'steps' | 'sleep'): Promise<EvidenceRecord[]> {
  const permissions: HealthKitPermissions = {
    permissions: { read: [AppleHealthKit.Constants.Permissions.StepCount, AppleHealthKit.Constants.Permissions.SleepAnalysis], write: [] },
  }
  const options = { startDate: new Date(Date.now() - LOOKBACK_H * 3600_000).toISOString(), endDate: new Date().toISOString() }
  return new Promise((resolve, reject) => {
    AppleHealthKit.initHealthKit(permissions, (err) => {
      if (err) return reject(new Error('Apple Health access was not granted.'))
      const done = (e: string, results: HealthValue[]) => {
        if (e) return reject(new Error('Could not read Apple Health.'))
        resolve(kind === 'steps' ? fromHealthKitSteps(results as unknown as HkSteps[]) : fromHealthKitSleep(results as unknown as HkSleep[]))
      }
      if (kind === 'steps') AppleHealthKit.getDailyStepCountSamples(options, done)
      else AppleHealthKit.getSleepSamples(options, done)
    })
  })
}

export default function App() {
  const url = ExpoLinking.useURL()
  const [req, setReq] = useState<SyncRequest | null>(null)
  const [records, setRecords] = useState<EvidenceRecord[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (url) { const r = parseSyncUrl(url); if (r) { setReq(r); setRecords(null); setMsg('') } } }, [url])

  async function sync() {
    if (!req) return
    setBusy(true); setMsg('')
    try {
      const recs = Platform.OS === 'android' ? await readAndroid(req.kind) : await readIos(req.kind)
      setRecords(recs)
      if (!recs.length) setMsg(req.kind === 'steps' ? 'No steps found for today.' : 'No sleep found for last night.')
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  function sendBack() {
    if (!req || !records) return
    const ev = buildEvidence(req, Platform.OS === 'ios' ? 'ios' : 'android', records)
    Linking.openURL(returnLink(req, ev))
  }

  const counted = records?.filter((r) => r.method !== 'manual') ?? []
  const manual = (records?.length ?? 0) - counted.length
  const total = req?.kind === 'steps' ? counted.reduce((s, r) => s + (r.value ?? 0), 0) : Math.round(counted.reduce((s, r) => s + (r.end - r.start), 0) / 60)

  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.mark}>commitpool</Text>
        {!req ? (
          <View style={s.card}>
            <Text style={s.h}>Open a pool first</Text>
            <Text style={s.p}>On the CommitPool website, open your pool and tap “Sync from the CommitPool app”, or scan its QR code with your camera. This app opens with the right pool.</Text>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.small}>Pool {req.pool} · day {req.day + 1}</Text>
            <Text style={s.h}>{req.kind === 'steps' ? 'Today’s steps' : 'Last night’s sleep'}</Text>
            <Text style={s.p}>We read it from {Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'} and send it back to the website. Your wallet signs it there, and the oracle checks it against the pool’s goal. Nothing is stored on our servers.</Text>
            {records && (
              <Text style={s.big}>{req.kind === 'steps' ? `${total.toLocaleString()} steps` : `${total} min asleep`}</Text>
            )}
            {manual > 0 && <Text style={s.warn}>{manual} manually entered record(s) won’t count.</Text>}
            {!!msg && <Text style={s.warn}>{msg}</Text>}
            {!records ? (
              <Pressable style={[s.btn, busy && s.dim]} disabled={busy} onPress={sync}><Text style={s.btnT}>{busy ? 'Reading…' : 'Read my data'}</Text></Pressable>
            ) : (
              <Pressable style={[s.btn, !counted.length && s.dim]} disabled={!counted.length} onPress={sendBack}><Text style={s.btnT}>Send to CommitPool</Text></Pressable>
            )}
          </View>
        )}
        <Text style={s.fine}>Beta. Device attestation (Play Integrity / App Attest) is not enabled yet, so the oracle marks this data as unverified.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#DDE5EA' },
  wrap: { padding: 20, gap: 16 },
  mark: { fontSize: 22, fontWeight: '800', color: '#13233A' },
  card: { backgroundColor: '#F5F7F8', borderRadius: 22, padding: 20, gap: 12 },
  small: { color: '#5B6B80', fontSize: 14 },
  h: { color: '#13233A', fontSize: 26, fontWeight: '800' },
  p: { color: '#13233A', fontSize: 16, lineHeight: 23 },
  big: { color: '#13233A', fontSize: 34, fontWeight: '800' },
  warn: { color: '#D8432E', fontSize: 15 },
  btn: { backgroundColor: '#F2B705', borderRadius: 999, paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: '#13233A' },
  btnT: { color: '#13233A', fontSize: 18, fontWeight: '700' },
  dim: { opacity: 0.5 },
  fine: { color: '#5B6B80', fontSize: 13 },
})
