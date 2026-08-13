import type { ReconstructedTeamMarketHistoryPoint } from './types'

const DAY_MS = 86_400_000

export type TeamRosterStateInput = {
  season: string
  week: number | null
  rosterId: number
  ownerUserId: string | null
  players: string[]
  observedAt?: string
  label?: string
}

export type HistoricalPlayerValueInput = {
  assetId: string
  observedAt: string
  value: number
}

export type FantasyCalcHistoryInput = {
  date?: unknown
  value?: unknown
  raw?: unknown
}

export type NormalizedFantasyCalcPoint = {
  observedAt: string
  providerValue: number
  rawValue: number | null
}

function isoDate(value: unknown): string | null {
  const input = String(value ?? '').trim()
  let parsed: Date
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [month, day, year] = input.split('/')
    parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  } else if (/^\d{6}$/.test(input)) {
    parsed = new Date(Date.UTC(2000 + Number(input.slice(0, 2)), Number(input.slice(2, 4)) - 1, Number(input.slice(4, 6))))
  } else {
    parsed = new Date(`${input.slice(0, 10)}T00:00:00Z`)
  }
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null
}

/**
 * Sleeper labels matchup history by NFL week, not by date. The regular season
 * begins on the Thursday after US Labor Day; Tuesday is the settled fantasy
 * close for that week. This gives each historical roster an explicit, stable
 * market-value anchor without pretending the D1 capture time was historical.
 */
export function nflWeekCloseDate(season: string, week: number): string | null {
  const year = Number(season)
  if (!Number.isInteger(year) || year < 2000 || week < 1 || week > 18) return null
  const septemberFirst = new Date(Date.UTC(year, 8, 1))
  const daysToMonday = (8 - septemberFirst.getUTCDay()) % 7
  const laborDay = new Date(septemberFirst.getTime() + daysToMonday * DAY_MS)
  const firstThursday = new Date(laborDay.getTime() + 3 * DAY_MS)
  return new Date(firstThursday.getTime() + ((week - 1) * 7 + 5) * DAY_MS).toISOString().slice(0, 10)
}

/** Keep the provider's first/latest observations and one point per seven days. */
export function normalizeFantasyCalcHistory(history: FantasyCalcHistoryInput[]): NormalizedFantasyCalcPoint[] {
  const byDate = new Map<string, NormalizedFantasyCalcPoint>()
  history.forEach((point) => {
    const observedAt = isoDate(point.date)
    const providerValue = Number(point.value)
    const rawValue = point.raw === null || point.raw === undefined ? null : Number(point.raw)
    if (!observedAt || !Number.isFinite(providerValue) || providerValue <= 0) return
    byDate.set(observedAt, {
      observedAt,
      providerValue,
      rawValue: rawValue !== null && Number.isFinite(rawValue) && rawValue > 0 ? rawValue : null,
    })
  })
  const daily = [...byDate.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  if (daily.length < 2) return daily
  const weekly = [daily[0]]
  let lastKept = Date.parse(`${daily[0].observedAt}T00:00:00Z`)
  daily.slice(1, -1).forEach((point) => {
    const timestamp = Date.parse(`${point.observedAt}T00:00:00Z`)
    if (timestamp - lastKept < 7 * DAY_MS) return
    weekly.push(point)
    lastKept = timestamp
  })
  const latest = daily[daily.length - 1]
  if (weekly[weekly.length - 1].observedAt !== latest.observedAt) weekly.push(latest)
  return weekly
}

function atOrBefore(
  values: HistoricalPlayerValueInput[],
  observedAt: string,
  maxStalenessDays: number,
): number | null {
  const target = Date.parse(`${observedAt}T23:59:59Z`)
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const candidate = values[index]
    const timestamp = Date.parse(`${candidate.observedAt}T00:00:00Z`)
    if (timestamp > target) continue
    if (target - timestamp > maxStalenessDays * DAY_MS) return null
    return Number.isFinite(candidate.value) && candidate.value > 0 ? candidate.value : null
  }
  return null
}

export function reconstructTeamPlayerHistory(
  rosterStates: TeamRosterStateInput[],
  observations: HistoricalPlayerValueInput[],
  maxStalenessDays = 8,
): ReconstructedTeamMarketHistoryPoint[] {
  const valuesByAsset = new Map<string, HistoricalPlayerValueInput[]>()
  observations.forEach((point) => {
    if (!point.assetId || !isoDate(point.observedAt) || !Number.isFinite(point.value) || point.value <= 0) return
    const values = valuesByAsset.get(point.assetId) ?? []
    values.push(point)
    valuesByAsset.set(point.assetId, values)
  })
  valuesByAsset.forEach((values) => values.sort((a, b) => a.observedAt.localeCompare(b.observedAt)))

  return rosterStates.flatMap((state) => {
    const observedAt = state.observedAt ?? (state.week ? nflWeekCloseDate(state.season, state.week) : null)
    const players = [...new Set(state.players.filter(Boolean))]
    if (!observedAt || !players.length) return []
    const covered = players.flatMap((assetId) => {
      const value = atOrBefore(valuesByAsset.get(assetId) ?? [], observedAt, maxStalenessDays)
      return value === null ? [] : [value]
    })
    return [{
      observedAt,
      season: state.season,
      week: state.week,
      label: state.label ?? (state.week ? `${state.season} W${state.week}` : `${state.season} current`),
      rosterId: state.rosterId,
      ownerUserId: state.ownerUserId,
      playerValue: Math.round(covered.reduce((sum, value) => sum + value, 0)),
      coveredPlayers: covered.length,
      rosterPlayers: players.length,
      coverageRate: covered.length / players.length,
      source: 'fantasycalc' as const,
    }]
  }).sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.rosterId - b.rosterId)
}
