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
  marketDistancePercent: number
  lineupDeltaMe: number | null
  lineupDeltaThem: number | null
  lineupCoveragePercent: number
  projectionCoverage: number
  rangeMe: { worst: number; best: number }
  providerNetToMe: { ktc: number | null; fantasycalc: number | null }
  draftCapitalSent: number
  draftCapitalReceived: number
  draftCapitalNetToMe: number
  outgoingAverageAgeAtHorizon: number | null
  incomingAverageAgeAtHorizon: number | null
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
}

export type TradeFrontierOptions = {
  myRosterId: number
  rosterPositions: string[]
  strategy?: ResolvedTeamStrategy
}

export type TradeFrontierCandidate = ComparablePackage & {
  counterpartRosterId: number
  counterpartName: string
  targetAsset: Asset
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
  if (strategy.mode === 'rebuilding' || strategy.mode === 'retooling') {
    comparisons.push({ mine: candidate.draftCapitalSent, theirs: other.draftCapitalSent, higherIsBetter: false })
    comparisons.push({ mine: candidate.draftCapitalNetToMe, theirs: other.draftCapitalNetToMe, higherIsBetter: true })
    if (candidate.outgoingAverageAgeAtHorizon !== null && other.outgoingAverageAgeAtHorizon !== null) {
      comparisons.push({ mine: candidate.outgoingAverageAgeAtHorizon, theirs: other.outgoingAverageAgeAtHorizon, higherIsBetter: true })
    }
    if (candidate.incomingAverageAgeAtHorizon !== null && other.incomingAverageAgeAtHorizon !== null) {
      comparisons.push({ mine: candidate.incomingAverageAgeAtHorizon, theirs: other.incomingAverageAgeAtHorizon, higherIsBetter: false })
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
  const tradeoffs = [
    `${Math.abs(marketGapPercent * 100).toFixed(1)}% from the current composite`,
    evidence.lineupImpactA === null
      ? `Lineup evidence guarded at ${lineupCoveragePercent}% coverage`
      : `${evidence.lineupImpactA >= 0 ? '+' : ''}${evidence.lineupImpactA.toFixed(1)} expected lineup PPG`,
  ]
  if (options.strategy.mode === 'rebuilding' || options.strategy.mode === 'retooling') {
    tradeoffs.push(evidence.packageA.pickValue
      ? `${Math.round(evidence.packageA.pickValue).toLocaleString()} current draft capital sent`
      : 'No draft capital sent')
    if (evidence.packageA.averageAgeAtHorizon !== null) {
      tradeoffs.push(`Outgoing player age ${evidence.packageA.averageAgeAtHorizon.toFixed(1)} at horizon`)
    }
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
    projectionCoverage: evidence.projectionCoverage,
    rangeMe: evidence.rangeA,
    providerNetToMe: evidence.providerNetA,
    draftCapitalSent: evidence.packageA.pickValue,
    draftCapitalReceived: evidence.packageB.pickValue,
    draftCapitalNetToMe: evidence.pickValueNetA,
    outgoingAverageAgeAtHorizon: evidence.packageA.averageAgeAtHorizon,
    incomingAverageAgeAtHorizon: evidence.packageB.averageAgeAtHorizon,
    frontier: false,
    tradeoffs,
  }
}

/** Produces an explicit Pareto set among the 60 closest observable
 * current-market packages for one selected basket. It does not use manager
 * tendencies, news, age curves, or an unvalidated return model. */
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
    }))

  const compared = markParetoFrontier(shortlist, strategy)
  return compared
    .sort((a, b) => (
      Number(b.frontier) - Number(a.frontier)
      || a.marketDistancePercent - b.marketDistancePercent
      || b.marketNetToMe - a.marketNetToMe
      || a.send.length - b.send.length
      || a.key.localeCompare(b.key)
    ))
    .slice(0, Math.max(1, Math.min(12, limit)))
}

/** Finds non-dominated single-target deals across the league. Each target is
 * paired with its closest current-value outgoing package, then compared on the
 * visible objectives. Ordering is a deterministic display tie-break, not a
 * hidden recommendation score. */
export function findTradeFrontier(
  teams: Team[],
  options: TradeFrontierOptions,
  limit = 8,
): TradeFrontierCandidate[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  if (!mine) return []
  const strategy = options.strategy ?? resolveTeamStrategy(mine)
  const outgoing = enumeratePackages([...mine.players, ...mine.picks])
  if (!outgoing.length) return []

  const candidates = teams
    .filter((team) => team.rosterId !== mine.rosterId)
    .flatMap((team) => [...team.players, ...team.picks]
      .filter((target) => target.value > 0)
      .map((target): TradeFrontierCandidate => {
        const closest = outgoing.reduce((best, candidate) => {
          const candidateGap = Math.abs(candidate.value - target.value)
          const bestGap = Math.abs(best.value - target.value)
          if (candidateGap !== bestGap) return candidateGap < bestGap ? candidate : best
          if (candidate.send.length !== best.send.length) return candidate.send.length < best.send.length ? candidate : best
          return candidate.key.localeCompare(best.key) < 0 ? candidate : best
        })
        return {
          ...toComparablePackage({
            raw: closest,
            receive: [target],
            mine,
            theirs: team,
            rosterPositions: options.rosterPositions,
            strategy,
          }),
          counterpartRosterId: team.rosterId,
          counterpartName: team.teamName,
          targetAsset: target,
        }
      }))

  const frontier = markParetoFrontier(candidates, strategy)
    .filter((candidate) => candidate.frontier)
  return frontier
    .sort((a, b) => (
      b.marketNetToMe - a.marketNetToMe
      || a.marketDistancePercent - b.marketDistancePercent
      || (b.lineupDeltaMe ?? Number.NEGATIVE_INFINITY) - (a.lineupDeltaMe ?? Number.NEGATIVE_INFINITY)
      || b.targetAsset.value - a.targetAsset.value
      || a.key.localeCompare(b.key)
    ))
    .slice(0, Math.max(1, Math.min(16, limit)))
}
