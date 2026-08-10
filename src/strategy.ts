import type { Asset, Team, TeamStrategyProfile } from './types'

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
