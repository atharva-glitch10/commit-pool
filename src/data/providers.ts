// Registry of habit data sources. Only SIMULATED is implemented.
//
// To add a real source (Android Health Connect, Apple HealthKit, a wearable API):
//   1. Implement HabitDataProvider (src/data/habits.ts) so it returns DayEntry[] with source 'DEVICE'.
//   2. Register it below. The verification engine and the UI need no changes.
// A DEVICE provider must also be authorised by the user and attested by a real oracle before it can
// feed an on-chain check-in. This registry only feeds the local preview.
import type { DataSource, HabitDataProvider } from './habits.ts'
import { demoProvider } from './demoHealthData.ts'

const PROVIDERS: Partial<Record<DataSource, HabitDataProvider>> = {
  SIMULATED: demoProvider,
}

export function getProvider(source: DataSource): HabitDataProvider | null {
  return PROVIDERS[source] ?? null
}

export const AVAILABLE_SOURCES = (Object.keys(PROVIDERS) as DataSource[])
