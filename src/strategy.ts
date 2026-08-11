import type { Asset, Team, TeamStrategyProfile } from './types'
import { evaluateTrade, packageValue } from './rankings'

export type ComparablePackage = {
  key: string
  send: Asset[]
  receive: Asset[]
  sendValue: number
  receiveValue: number
  marketNetToMe: number
  marketGapPercent: number
  lineupDeltaMe: number | null
  lineupDeltaThem: number | null
  projectionCoverage: number
  rangeMe: { worst: number; best: number }
}

export type ComparablePackageOptions = {
  myRosterId: number
  counterpartRosterId: number
  rosterPositions: string[]
  targetAssetId: string
}

export type ResolvedTeamStrategy = {
  mode: 'neutral' | 'contender' | 'retooling' | 'rebuilding'
  horizonYears: 1 | 2 | 3 | 4
  flipPriority: number
}

/** A declared objective, not a model prediction. Automatic mode remains
 * neutral instead of inferring a competitive window from an unvalidated rule. */
export function resolveTeamStrategy(team: Team, input?: TeamStrategyProfile): ResolvedTeamStrategy {
  void team
  const mode = input?.mode && input.mode !== 'auto' ? input.mode : 'neutral'
  return {
    mode,
    horizonYears: input?.horizonYears ?? (mode === 'contender' ? 1 : mode === 'rebuilding' ? 3 : 2),
    flipPriority: input?.flipPriority ?? 0,
  }
}

/** Produces the closest observable current-market packages for one selected
 * target. This is a bounded comparison tool, not an offer recommendation: it
 * does not use manager tendencies, news, age, or an unvalidated return model to
 * rank packages, and it never emits an acceptance or profit probability. */
export function findComparablePackages(
  teams: Team[],
  options: ComparablePackageOptions,
  limit = 6,
): ComparablePackage[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  const theirs = teams.find((team) => team.rosterId === options.counterpartRosterId)
  if (!mine || !theirs || mine.rosterId === theirs.rosterId) return []
  const target = [...theirs.players, ...theirs.picks].find((asset) => asset.id === options.targetAssetId)
  if (!target || target.value <= 0) return []

  const pool = [...mine.players, ...mine.picks]
    .filter((asset) => asset.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, 50)
  const raw: Array<{ send: Asset[]; value: number; key: string }> = []
  for (let first = 0; first < pool.length; first += 1) {
    const one = [pool[first]]
    raw.push({ send: one, value: packageValue(one), key: pool[first].id })
    for (let second = first + 1; second < pool.length; second += 1) {
      const two = [pool[first], pool[second]]
      raw.push({ send: two, value: packageValue(two), key: two.map((asset) => asset.id).join('+') })
      for (let third = second + 1; third < pool.length; third += 1) {
        const three = [pool[first], pool[second], pool[third]]
        raw.push({ send: three, value: packageValue(three), key: three.map((asset) => asset.id).join('+') })
      }
    }
  }

  const targetValue = packageValue([target])
  return raw
    .sort((a, b) => (
      Math.abs(a.value - targetValue) - Math.abs(b.value - targetValue)
      || a.send.length - b.send.length
      || a.key.localeCompare(b.key)
    ))
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map((candidate) => {
      const evidence = evaluateTrade(candidate.send, [target], {
        teamA: mine,
        teamB: theirs,
        rosterPositions: options.rosterPositions,
      })
      return {
        key: `${theirs.rosterId}:${target.id}:${candidate.key}`,
        send: candidate.send,
        receive: [target],
        sendValue: candidate.value,
        receiveValue: targetValue,
        marketNetToMe: targetValue - candidate.value,
        marketGapPercent: targetValue ? (candidate.value - targetValue) / targetValue : 0,
        lineupDeltaMe: evidence.lineupImpactA,
        lineupDeltaThem: evidence.lineupImpactB,
        projectionCoverage: evidence.projectionCoverage,
        rangeMe: evidence.rangeA,
      }
    })
}
