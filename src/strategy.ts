import type { Asset, Team, TeamStrategyProfile } from './types'
import { evaluateTrade, packageValue } from './rankings'

export type StrategyDirection = 'buy' | 'sell'
export type OfferStage = 'opening' | 'target' | 'counter' | 'walk-away'

/** Retained for stored preference compatibility. These fields are observations,
 * not probabilities, and are not used to predict an offer response. */
export type ManagerPreferences = {
  pickAffinity?: number
  playerAffinity?: number
  consolidationIndex?: number
  depthIndex?: number
  positionAffinity?: Partial<Record<Asset['position'], number>>
  sampleWeight?: number
}

export type TargetReason = { label: string; value: string }

export type TargetCandidate = {
  asset: Asset
  ownerRosterId: number
  currentMarketValue: number
  ageAtHorizon: number | null
  projectionCovered: boolean
  reasons: TargetReason[]
}

/** The package type remains readable for previously stored offers. New packages
 * are deliberately not generated until response and historical price labels exist. */
export type GeneratedPackage = {
  stage: OfferStage
  send: Asset[]
  receive: Asset[]
  marketDelta: number
  lineupDeltaMe: number
  lineupDeltaThem: number
  explanation: string
}

export type TradePlan = {
  myRosterId: number
  counterpartRosterId: number
  direction: StrategyDirection
  targets: TargetCandidate[]
  packages: GeneratedPackage[]
  evidenceNote: string
}

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

export type StrategyOptions = {
  myRosterId: number
  counterpartRosterId: number
  rosterPositions: string[]
  direction?: StrategyDirection
  manager?: ManagerPreferences
  teamStrategy?: TeamStrategyProfile
  maxTargets?: number
  targetAssetId?: string
}

export type ResolvedTeamStrategy = {
  mode: 'contender' | 'retooling' | 'rebuilding'
  horizonYears: 1 | 2 | 3 | 4
  flipPriority: number
}

/** A declared objective, not a model prediction. Automatic mode is a plain
 * comparison of the app's current-lineup and future-base roster summaries. */
export function resolveTeamStrategy(team: Team, input?: TeamStrategyProfile): ResolvedTeamStrategy {
  void team
  const mode = input?.mode && input.mode !== 'auto' ? input.mode : 'retooling'
  return {
    mode,
    horizonYears: input?.horizonYears ?? (mode === 'contender' ? 1 : mode === 'retooling' ? 2 : 3),
    flipPriority: input?.flipPriority ?? 0,
  }
}

/** An evidence inventory of another roster. Ordering is current composite market
 * value only. News, age curves, manager behavior, and invented profit scores do
 * not move the list. */
export function findTargets(teams: Team[], options: StrategyOptions): TargetCandidate[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  const theirs = teams.find((team) => team.rosterId === options.counterpartRosterId)
  if (!mine || !theirs || mine.rosterId === theirs.rosterId) return []
  const horizon = resolveTeamStrategy(mine, options.teamStrategy).horizonYears
  return [...theirs.players, ...theirs.picks]
    .filter((asset) => asset.value > 0)
    .map((asset) => ({
      asset,
      ownerRosterId: theirs.rosterId,
      currentMarketValue: Math.round(asset.value),
      ageAtHorizon: asset.kind === 'player' && asset.age !== null && asset.age !== undefined
        ? asset.age + horizon
        : null,
      projectionCovered: asset.kind === 'player' && asset.projectedPpg !== undefined,
      reasons: [
        { label: 'Current market', value: Math.round(asset.value).toLocaleString() },
        { label: 'Production model', value: asset.projectedPpg === undefined ? 'Not covered' : 'Covered' },
      ],
    }))
    .filter((candidate) => !options.targetAssetId || candidate.asset.id === options.targetAssetId)
    .sort((a, b) => b.currentMarketValue - a.currentMarketValue || a.asset.id.localeCompare(b.asset.id))
    .slice(0, options.maxTargets ?? 8)
}

export function buildTradePlan(teams: Team[], options: StrategyOptions): TradePlan {
  return {
    myRosterId: options.myRosterId,
    counterpartRosterId: options.counterpartRosterId,
    direction: options.direction ?? 'buy',
    targets: findTargets(teams, options),
    packages: [],
    evidenceNote: 'Automated offers are off. RosterLab needs historical market returns and real accepted, rejected, and countered offer labels before it can estimate exit value or manager acceptance.',
  }
}

/** Produces the closest observable current-market packages for one selected
 * target. This is a bounded comparison tool, not an offer recommendation: it
 * does not use manager tendencies, news, age, or an unvalidated return model to
 * rank packages, and it never emits an acceptance or profit probability. */
export function findComparablePackages(
  teams: Team[],
  options: StrategyOptions & { targetAssetId: string },
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
