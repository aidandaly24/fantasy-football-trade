import type { Asset, Team, TeamStrategyProfile } from './types'
import { evaluateTrade, packageValue } from './rankings'
import { evaluateRebuildPortfolioTrade } from './asset-returns'
import type { AssetReturnHealthBundle, PortfolioTradeDelta } from './asset-returns'

export type ComparablePackage = {
  key: string
  send: Asset[]
  receive: Asset[]
  sendValue: number
  receiveValue: number
  marketNetToMe: number
  marketGapPercent: number
  marketDistancePercent: number
  lineupDeltaMe: number | null
  lineupDeltaThem: number | null
  lineupCoveragePercent: number
  currentSeasonPowerDeltaMe: number | null
  currentSeasonPowerDeltaThem: number | null
  currentSeasonCoveragePercent: number
  projectionCoverage: number
  rangeMe: { worst: number; best: number }
  providerNetToMe: { ktc: number | null; fantasycalc: number | null }
  draftCapitalSent: number
  draftCapitalReceived: number
  draftCapitalNetToMe: number
  outgoingAverageAgeAtHorizon: number | null
  incomingAverageAgeAtHorizon: number | null
  portfolio: PortfolioTradeDelta | null
  frontier: boolean
  tradeoffs: string[]
}

export type ComparablePackageOptions = {
  myRosterId: number
  counterpartRosterId: number
  rosterPositions: string[]
  targetAssetId?: string
  targetAssetIds?: string[]
  strategy?: ResolvedTeamStrategy
  assetReturnHealth?: AssetReturnHealthBundle | null
  numQbs?: 1 | 2
}

export type TradeFrontierOptions = {
  myRosterId: number
  rosterPositions: string[]
  strategy?: ResolvedTeamStrategy
  assetReturnHealth?: AssetReturnHealthBundle | null
  numQbs?: 1 | 2
}

export type TradeFrontierCandidate = ComparablePackage & {
  counterpartRosterId: number
  counterpartName: string
  targetAsset: Asset
}

export type NegotiationStage = 'ambitious-opening' | 'fair-target' | 'walk-away'

export type NegotiationStep = {
  stage: NegotiationStage
  package: ComparablePackage
  explanation: string
}

export type ResolvedTeamStrategy = {
  mode: 'neutral' | 'contender' | 'retooling' | 'rebuilding'
  horizonYears: 1 | 2 | 3 | 4
  flipPriority: number
}

type RawPackage = { send: Asset[]; value: number; key: string }

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

function enumeratePackages(assets: Asset[]): RawPackage[] {
  const pool = [...assets]
    .filter((asset) => asset.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, 50)
  const packages: RawPackage[] = []
  for (let first = 0; first < pool.length; first += 1) {
    const one = [pool[first]]
    packages.push({ send: one, value: packageValue(one), key: pool[first].id })
    for (let second = first + 1; second < pool.length; second += 1) {
      const two = [pool[first], pool[second]]
      packages.push({ send: two, value: packageValue(two), key: two.map((asset) => asset.id).join('+') })
      for (let third = second + 1; third < pool.length; third += 1) {
        const three = [pool[first], pool[second], pool[third]]
        packages.push({ send: three, value: packageValue(three), key: three.map((asset) => asset.id).join('+') })
      }
    }
  }
  return packages
}

function dominates(
  candidate: ComparablePackage,
  other: ComparablePackage,
  strategy: ResolvedTeamStrategy,
): boolean {
  const comparisons: Array<{ mine: number; theirs: number; higherIsBetter: boolean }> = [
    { mine: candidate.marketNetToMe, theirs: other.marketNetToMe, higherIsBetter: true },
    { mine: candidate.marketDistancePercent, theirs: other.marketDistancePercent, higherIsBetter: false },
    { mine: candidate.lineupCoveragePercent, theirs: other.lineupCoveragePercent, higherIsBetter: true },
  ]
  if (candidate.lineupDeltaMe !== null && other.lineupDeltaMe !== null) {
    comparisons.push({ mine: candidate.lineupDeltaMe, theirs: other.lineupDeltaMe, higherIsBetter: true })
  }
  if (candidate.currentSeasonPowerDeltaMe !== null && other.currentSeasonPowerDeltaMe !== null) {
    comparisons.push({ mine: candidate.currentSeasonPowerDeltaMe, theirs: other.currentSeasonPowerDeltaMe, higherIsBetter: true })
  }
  if (strategy.mode === 'rebuilding' || strategy.mode === 'retooling') {
    comparisons.push({ mine: candidate.draftCapitalSent, theirs: other.draftCapitalSent, higherIsBetter: false })
    comparisons.push({ mine: candidate.draftCapitalNetToMe, theirs: other.draftCapitalNetToMe, higherIsBetter: true })
    if (candidate.outgoingAverageAgeAtHorizon !== null && other.outgoingAverageAgeAtHorizon !== null) {
      comparisons.push({ mine: candidate.outgoingAverageAgeAtHorizon, theirs: other.outgoingAverageAgeAtHorizon, higherIsBetter: true })
    }
    if (candidate.incomingAverageAgeAtHorizon !== null && other.incomingAverageAgeAtHorizon !== null) {
      comparisons.push({ mine: candidate.incomingAverageAgeAtHorizon, theirs: other.incomingAverageAgeAtHorizon, higherIsBetter: false })
    }
    if (candidate.portfolio && other.portfolio) {
      if (candidate.portfolio.expectedPnl30 !== null && other.portfolio.expectedPnl30 !== null) {
        comparisons.push({ mine: candidate.portfolio.expectedPnl30, theirs: other.portfolio.expectedPnl30, higherIsBetter: true })
      }
      if (candidate.portfolio.trackedAssetLowerPnl30 !== null && other.portfolio.trackedAssetLowerPnl30 !== null) {
        comparisons.push({ mine: candidate.portfolio.trackedAssetLowerPnl30, theirs: other.portfolio.trackedAssetLowerPnl30, higherIsBetter: true })
      }
      if (candidate.portfolio.maxDrawdown180 !== null && other.portfolio.maxDrawdown180 !== null) {
        comparisons.push({ mine: candidate.portfolio.maxDrawdown180, theirs: other.portfolio.maxDrawdown180, higherIsBetter: true })
      }
      if (candidate.portfolio.concentrationHhi !== null && other.portfolio.concentrationHhi !== null) {
        comparisons.push({ mine: candidate.portfolio.concentrationHhi, theirs: other.portfolio.concentrationHhi, higherIsBetter: false })
      }
    }
  }

  let strictlyBetter = false
  for (const comparison of comparisons) {
    if (comparison.higherIsBetter) {
      if (comparison.mine < comparison.theirs) return false
      if (comparison.mine > comparison.theirs) strictlyBetter = true
    } else {
      if (comparison.mine > comparison.theirs) return false
      if (comparison.mine < comparison.theirs) strictlyBetter = true
    }
  }
  return strictlyBetter
}

function markParetoFrontier<T extends ComparablePackage>(candidates: T[], strategy: ResolvedTeamStrategy): Array<T & { frontier: boolean }> {
  return candidates.map((candidate, index) => ({
    ...candidate,
    frontier: !candidates.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate, strategy)),
  }))
}

function toComparablePackage(options: {
  raw: RawPackage
  receive: Asset[]
  mine: Team
  theirs: Team
  rosterPositions: string[]
  strategy: ResolvedTeamStrategy
  assetReturnHealth?: AssetReturnHealthBundle | null
  numQbs?: 1 | 2
}): ComparablePackage {
  const receiveValue = packageValue(options.receive)
  const evidence = evaluateTrade(options.raw.send, options.receive, {
    teamA: options.mine,
    teamB: options.theirs,
    rosterPositions: options.rosterPositions,
    horizonYears: options.strategy.horizonYears,
  })
  const marketGapPercent = receiveValue ? (options.raw.value - receiveValue) / receiveValue : 0
  const lineupCoveragePercent = evidence.lineupScenarioA
    ? Math.min(evidence.lineupScenarioA.beforeCoverage.percent, evidence.lineupScenarioA.afterCoverage.percent)
    : 0
  const currentSeasonCoveragePercent = evidence.currentSeasonScenarioA
    ? Math.min(evidence.currentSeasonScenarioA.before.coveragePercent, evidence.currentSeasonScenarioA.after.coveragePercent)
    : 0
  const tradeoffs = [
    `${Math.abs(marketGapPercent * 100).toFixed(1)}% from the current composite`,
    evidence.lineupImpactA === null
      ? `Lineup evidence guarded at ${lineupCoveragePercent}% coverage`
      : `${evidence.lineupImpactA >= 0 ? '+' : ''}${evidence.lineupImpactA.toFixed(1)} expected lineup PPG`,
    evidence.currentSeasonImpactA === null
      ? `Current-season power guarded at ${currentSeasonCoveragePercent}% coverage`
      : `${evidence.currentSeasonImpactA >= 0 ? '+' : ''}${evidence.currentSeasonImpactA} current-season lineup power`,
  ]
  if (options.strategy.mode === 'rebuilding' || options.strategy.mode === 'retooling') {
    tradeoffs.push(evidence.packageA.pickValue
      ? `${Math.round(evidence.packageA.pickValue).toLocaleString()} current draft capital sent`
      : 'No draft capital sent')
    if (evidence.packageA.averageAgeAtHorizon !== null) {
      tradeoffs.push(`Outgoing player age ${evidence.packageA.averageAgeAtHorizon.toFixed(1)} at horizon`)
    }
  }
  const portfolio = (options.strategy.mode === 'rebuilding' || options.strategy.mode === 'retooling')
    && options.assetReturnHealth && options.numQbs
    ? evaluateRebuildPortfolioTrade({
        team: options.mine,
        outgoing: options.raw.send,
        incoming: options.receive,
        bundle: options.assetReturnHealth,
        numQbs: options.numQbs,
        horizonYears: options.strategy.horizonYears,
      })
    : null
  if (portfolio) {
    tradeoffs.push(portfolio.expectedPnl30 === null
      ? `30-day return evidence unavailable · ${Math.round(portfolio.returnCoverage * 100)}% post-trade coverage`
      : `${portfolio.expectedPnl30 >= 0 ? '+' : ''}${portfolio.expectedPnl30.toFixed(0)} FantasyCalc-value expected 30-day P&L delta · ${Math.round(portfolio.returnCoverage * 100)}% coverage`)
  }

  return {
    key: `${options.theirs.rosterId}:${options.receive.map((asset) => asset.id).join('+')}:${options.raw.key}`,
    send: options.raw.send,
    receive: options.receive,
    sendValue: options.raw.value,
    receiveValue,
    marketNetToMe: receiveValue - options.raw.value,
    marketGapPercent,
    marketDistancePercent: Math.abs(marketGapPercent),
    lineupDeltaMe: evidence.lineupImpactA,
    lineupDeltaThem: evidence.lineupImpactB,
    lineupCoveragePercent,
    currentSeasonPowerDeltaMe: evidence.currentSeasonImpactA,
    currentSeasonPowerDeltaThem: evidence.currentSeasonImpactB,
    currentSeasonCoveragePercent,
    projectionCoverage: evidence.projectionCoverage,
    rangeMe: evidence.rangeA,
    providerNetToMe: evidence.providerNetA,
    draftCapitalSent: evidence.packageA.pickValue,
    draftCapitalReceived: evidence.packageB.pickValue,
    draftCapitalNetToMe: evidence.pickValueNetA,
    outgoingAverageAgeAtHorizon: evidence.packageA.averageAgeAtHorizon,
    incomingAverageAgeAtHorizon: evidence.packageB.averageAgeAtHorizon,
    portfolio,
    frontier: false,
    tradeoffs,
  }
}

/** Produces an explicit Pareto set among the 60 closest observable
 * current-market packages for one selected basket. A supplied, promoted asset
 * return artifact participates only for a declared rebuild/retool objective.
 * Manager tendencies, news, and unvalidated horizons are excluded. */
export function findComparablePackages(
  teams: Team[],
  options: ComparablePackageOptions,
  limit = 8,
): ComparablePackage[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  const theirs = teams.find((team) => team.rosterId === options.counterpartRosterId)
  if (!mine || !theirs || mine.rosterId === theirs.rosterId) return []
  const requestedIds = options.targetAssetIds?.length
    ? options.targetAssetIds
    : options.targetAssetId ? [options.targetAssetId] : []
  const requested = new Set(requestedIds)
  const receive = [...theirs.players, ...theirs.picks].filter((asset) => requested.has(asset.id))
  if (!receive.length || receive.length !== requested.size || receive.some((asset) => asset.value <= 0)) return []

  const strategy = options.strategy ?? resolveTeamStrategy(mine)
  const receiveValue = packageValue(receive)
  const shortlist = enumeratePackages([...mine.players, ...mine.picks])
    .sort((a, b) => (
      Math.abs(a.value - receiveValue) - Math.abs(b.value - receiveValue)
      || a.send.length - b.send.length
      || a.key.localeCompare(b.key)
    ))
    .slice(0, 60)
    .map((raw) => toComparablePackage({
      raw,
      receive,
      mine,
      theirs,
      rosterPositions: options.rosterPositions,
      strategy,
      assetReturnHealth: options.assetReturnHealth,
      numQbs: options.numQbs,
    }))

  const compared = markParetoFrontier(shortlist, strategy)
  return compared
    .sort((a, b) => (
      Number(b.frontier) - Number(a.frontier)
      || a.marketDistancePercent - b.marketDistancePercent
      || (b.currentSeasonPowerDeltaMe ?? Number.NEGATIVE_INFINITY) - (a.currentSeasonPowerDeltaMe ?? Number.NEGATIVE_INFINITY)
      || b.marketNetToMe - a.marketNetToMe
      || a.send.length - b.send.length
      || a.key.localeCompare(b.key)
    ))
    .slice(0, Math.max(1, Math.min(12, limit)))
}

function nearestPackages(outgoing: RawPackage[], targetValue: number, limit = 4): RawPackage[] {
  const nearest: RawPackage[] = []
  outgoing.forEach((candidate) => {
    nearest.push(candidate)
    nearest.sort((a, b) => (
      Math.abs(a.value - targetValue) - Math.abs(b.value - targetValue)
      || a.send.length - b.send.length
      || a.key.localeCompare(b.key)
    ))
    if (nearest.length > limit) nearest.pop()
  })
  return nearest
}

function targetCandidateSet(
  teams: Team[],
  options: TradeFrontierOptions,
): { mine: Team; strategy: ResolvedTeamStrategy; candidates: TradeFrontierCandidate[] } | null {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  if (!mine) return null
  const strategy = options.strategy ?? resolveTeamStrategy(mine)
  const outgoing = enumeratePackages([...mine.players, ...mine.picks])
  if (!outgoing.length) return null

  const candidates = teams
    .filter((team) => team.rosterId !== mine.rosterId)
    .flatMap((team) => [...team.players, ...team.picks]
      .filter((target) => target.value > 0)
      .map((target): TradeFrontierCandidate => {
        const variants = nearestPackages(outgoing, target.value).map((raw): TradeFrontierCandidate => ({
          ...toComparablePackage({
            raw,
            receive: [target],
            mine,
            theirs: team,
            rosterPositions: options.rosterPositions,
            strategy,
            assetReturnHealth: options.assetReturnHealth,
            numQbs: options.numQbs,
          }),
          counterpartRosterId: team.rosterId,
          counterpartName: team.teamName,
          targetAsset: target,
        }))
        const localFrontier = markParetoFrontier(variants, strategy).filter((candidate) => candidate.frontier)
        return localFrontier.sort((a, b) => (
          strategy.mode === 'rebuilding' || strategy.mode === 'retooling'
            ? rebuildPackageOrder(a, b)
            : a.marketDistancePercent - b.marketDistancePercent || b.marketNetToMe - a.marketNetToMe || a.key.localeCompare(b.key)
        ))[0]
      }))

  return { mine, strategy, candidates }
}

function rebuildPackageOrder(a: ComparablePackage, b: ComparablePackage): number {
  return (
    (b.portfolio?.trackedAssetLowerPnl30 ?? Number.NEGATIVE_INFINITY) - (a.portfolio?.trackedAssetLowerPnl30 ?? Number.NEGATIVE_INFINITY)
    || (b.portfolio?.expectedPnl30 ?? Number.NEGATIVE_INFINITY) - (a.portfolio?.expectedPnl30 ?? Number.NEGATIVE_INFINITY)
    || a.marketDistancePercent - b.marketDistancePercent
    || b.marketNetToMe - a.marketNetToMe
    || a.send.length - b.send.length
    || a.key.localeCompare(b.key)
  )
}

/** Finds non-dominated single-target deals across the league. Each target is
 * paired with the best visible Pareto option among its four closest
 * current-value packages, then compared across the league. The rebuild display
 * tie-break prioritizes tracked downside and promoted 30-day return before
 * current-price distance; this declared order is not a hidden score. */
export function findTradeFrontier(
  teams: Team[],
  options: TradeFrontierOptions,
  limit = 8,
): TradeFrontierCandidate[] {
  const result = targetCandidateSet(teams, options)
  if (!result) return []

  const frontier = markParetoFrontier(result.candidates, result.strategy)
    .filter((candidate) => candidate.frontier)
  return frontier
    .sort((a, b) => (
      (result.strategy.mode === 'rebuilding' || result.strategy.mode === 'retooling' ? rebuildPackageOrder(a, b) : 0)
      || b.marketNetToMe - a.marketNetToMe
      || a.marketDistancePercent - b.marketDistancePercent
      || (b.lineupDeltaMe ?? Number.NEGATIVE_INFINITY) - (a.lineupDeltaMe ?? Number.NEGATIVE_INFINITY)
      || b.targetAsset.value - a.targetAsset.value
      || a.key.localeCompare(b.key)
    ))
    .slice(0, Math.max(1, Math.min(16, limit)))
}

/** Builds negotiation anchors from the actual displayed package set. The
 * opening is the nearest cheaper package, the target is closest to current
 * market, and the walk-away is the nearest more expensive package. These are
 * price anchors, not acceptance predictions or model confidence. */
export function buildNegotiationLadder(candidates: ComparablePackage[]): NegotiationStep[] {
  if (!candidates.length) return []
  const fair = [...candidates].sort((a, b) => (
    a.marketDistancePercent - b.marketDistancePercent
    || a.sendValue - b.sendValue
    || a.key.localeCompare(b.key)
  ))[0]
  const cheaper = candidates
    .filter((candidate) => candidate.sendValue < fair.sendValue)
    .sort((a, b) => b.sendValue - a.sendValue || a.key.localeCompare(b.key))[0]
  const dearer = candidates
    .filter((candidate) => candidate.sendValue > fair.sendValue)
    .sort((a, b) => a.sendValue - b.sendValue || a.key.localeCompare(b.key))[0]
  const steps: NegotiationStep[] = []
  if (cheaper) steps.push({
    stage: 'ambitious-opening',
    package: cheaper,
    explanation: 'Nearest lower-priced package in the displayed evidence set; a deliberate ambitious opening, not an acceptance estimate.',
  })
  steps.push({
    stage: 'fair-target',
    package: fair,
    explanation: 'Package closest to the target basket on the current composite scale.',
  })
  if (dearer) steps.push({
    stage: 'walk-away',
    package: dearer,
    explanation: 'Next higher-priced evidence anchor. Treat this as the comparison ceiling, not a recommendation to pay it.',
  })
  return steps
}
