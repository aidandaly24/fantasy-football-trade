import type { TeamDirection } from './edge'
import { evaluateTrade, optimizeLineup } from './rankings'
import type { ResolvedTeamStrategy } from './strategy'
import type { Asset, Team } from './types'

const SKILL_POSITIONS = new Set<Asset['position']>(['QB', 'RB', 'WR', 'TE'])

export type DislocationLens = 'frontier' | 'market' | 'production' | 'pressure'
export type DislocationCategory = 'market-gap' | 'production-ahead' | 'owner-depth' | 'active-trader'

export type MarketDislocation = {
  key: string
  asset: Asset
  owner: Team
  market: {
    ktc: number | null
    fantasycalc: number | null
    ktcRank: number | null
    fantasycalcRank: number | null
    population: number
    ktcPercentile: number | null
    fantasycalcPercentile: number | null
    percentileGap: number | null
    higherRankSource: 'KTC' | 'FantasyCalc' | 'equal' | null
  }
  production: {
    projectedPpg: number | null
    marketRank: number
    marketPopulation: number
    productionRank: number | null
    productionPopulation: number
    marketPercentile: number
    productionPercentile: number | null
    percentileGap: number | null
  }
  pressure: {
    ownerLikelyStarter: boolean
    ownerPositionCount: number
    dedicatedSlots: number
    countAboveDedicatedSlots: number
    myLineupDelta: number | null
    ownerLineupLoss: number | null
    directionLabel: TeamDirection['label']
    directionManual: boolean
    recentTrades: number
    playerValueFlow: number
    pickValueFlow: number
  }
  horizon: {
    years: ResolvedTeamStrategy['horizonYears']
    ageAtHorizon: number | null
  }
  categories: DislocationCategory[]
  frontier: boolean
  evidence: string[]
}

export type MarketDislocationOptions = {
  myRosterId: number
  rosterPositions: string[]
  directions: TeamDirection[]
  strategy: ResolvedTeamStrategy
  excludedAssetIds?: string[]
}

type RosteredPlayer = { key: string; asset: Asset; owner: Team }

function positiveSource(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && value > 0 ? value : null
}

function rankFact(
  players: RosteredPlayer[],
  target: RosteredPlayer,
  value: (player: RosteredPlayer) => number,
): { rank: number; percentile: number } {
  const targetValue = value(target)
  const higher = players.filter((player) => value(player) > targetValue).length
  const equal = players.filter((player) => value(player) === targetValue).length
  const rank = higher + 1
  if (players.length <= 1) return { rank, percentile: 1 }
  const averageRank = higher + (equal + 1) / 2
  return { rank, percentile: (players.length - averageRank) / (players.length - 1) }
}

function numberOr(value: number | null, fallback: number): number {
  return value === null ? fallback : value
}

function dominates(
  candidate: MarketDislocation,
  other: MarketDislocation,
  strategy: ResolvedTeamStrategy,
): boolean {
  const comparisons: Array<{ mine: number; theirs: number; higherIsBetter: boolean }> = [
    { mine: numberOr(candidate.market.percentileGap, Number.NEGATIVE_INFINITY), theirs: numberOr(other.market.percentileGap, Number.NEGATIVE_INFINITY), higherIsBetter: true },
    { mine: numberOr(candidate.production.percentileGap, Number.NEGATIVE_INFINITY), theirs: numberOr(other.production.percentileGap, Number.NEGATIVE_INFINITY), higherIsBetter: true },
    { mine: numberOr(candidate.pressure.myLineupDelta, Number.NEGATIVE_INFINITY), theirs: numberOr(other.pressure.myLineupDelta, Number.NEGATIVE_INFINITY), higherIsBetter: true },
    { mine: candidate.pressure.ownerLikelyStarter ? 0 : 1, theirs: other.pressure.ownerLikelyStarter ? 0 : 1, higherIsBetter: true },
    { mine: candidate.pressure.countAboveDedicatedSlots, theirs: other.pressure.countAboveDedicatedSlots, higherIsBetter: true },
    { mine: candidate.pressure.recentTrades, theirs: other.pressure.recentTrades, higherIsBetter: true },
    { mine: numberOr(candidate.pressure.ownerLineupLoss, Number.POSITIVE_INFINITY), theirs: numberOr(other.pressure.ownerLineupLoss, Number.POSITIVE_INFINITY), higherIsBetter: false },
  ]
  if (strategy.mode === 'rebuilding' || strategy.mode === 'retooling') {
    comparisons.push({
      mine: numberOr(candidate.horizon.ageAtHorizon, Number.POSITIVE_INFINITY),
      theirs: numberOr(other.horizon.ageAtHorizon, Number.POSITIVE_INFINITY),
      higherIsBetter: false,
    })
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

function evidenceFor(candidate: Omit<MarketDislocation, 'frontier' | 'evidence'>): string[] {
  const evidence: string[] = []
  if (candidate.market.percentileGap !== null && candidate.market.higherRankSource !== null) {
    evidence.push(candidate.market.higherRankSource === 'equal'
      ? `KTC and FantasyCalc give the player the same relative rank in the ${candidate.market.population}-player dual-source pool.`
      : `KTC ranks the player ${candidate.market.ktcRank}/${candidate.market.population} and FantasyCalc ranks the player ${candidate.market.fantasycalcRank}/${candidate.market.population}, a ${candidate.market.percentileGap.toFixed(1)} percentile-point gap with ${candidate.market.higherRankSource} higher.`)
  }
  if (candidate.production.percentileGap !== null) {
    evidence.push(`Modeled production percentile is ${candidate.production.percentileGap >= 0 ? '+' : ''}${candidate.production.percentileGap.toFixed(0)} points versus market within ${candidate.asset.position}.`)
  }
  evidence.push(candidate.pressure.ownerLikelyStarter
    ? 'The player is in the owner’s current-value likely lineup.'
    : 'The player is outside the owner’s current-value likely lineup.')
  evidence.push(`${candidate.owner.teamName} rosters ${candidate.pressure.ownerPositionCount} ${candidate.asset.position}s for ${candidate.pressure.dedicatedSlots} dedicated slot${candidate.pressure.dedicatedSlots === 1 ? '' : 's'}; flex eligibility is separate.`)
  if (candidate.pressure.recentTrades > 0) {
    evidence.push(`${candidate.pressure.recentTrades} completed trade${candidate.pressure.recentTrades === 1 ? '' : 's'} in the current manager-activity lookback.`)
  }
  return evidence
}

/** Builds a current-state evidence inventory. Every field is a direct provider
 * comparison, a within-league percentile, or a factual roster/transaction
 * measurement. Pareto membership is not an acceptance or return prediction. */
export function buildMarketDislocations(
  teams: Team[],
  options: MarketDislocationOptions,
): MarketDislocation[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  if (!mine) return []
  const excluded = new Set(options.excludedAssetIds ?? [])
  const directionByRoster = new Map(options.directions.map((direction) => [direction.rosterId, direction]))
  const players = teams.flatMap((owner) => owner.players
    .filter((asset) => asset.kind === 'player' && SKILL_POSITIONS.has(asset.position) && asset.value > 0)
    .map((asset): RosteredPlayer => ({ key: `${owner.rosterId}:${asset.id}`, asset, owner })))
  const byPosition = new Map<Asset['position'], RosteredPlayer[]>()
  players.forEach((player) => {
    const group = byPosition.get(player.asset.position) ?? []
    group.push(player)
    byPosition.set(player.asset.position, group)
  })
  const dualSourcePlayers = players.filter((player) => (
    positiveSource(player.asset.marketSources?.ktc) !== null
    && positiveSource(player.asset.marketSources?.fantasycalc) !== null
  ))

  const candidates = players
    .filter((player) => player.owner.rosterId !== mine.rosterId && !excluded.has(player.asset.id))
    .map((player): MarketDislocation => {
      const positionPlayers = byPosition.get(player.asset.position) ?? []
      const coveredPositionPlayers = positionPlayers.filter((item) => item.asset.projectedPpg !== undefined)
      const marketPopulation = player.asset.projectedPpg === undefined ? positionPlayers : coveredPositionPlayers
      const productionPopulation = positionPlayers
        .filter((item) => item.asset.projectedPpg !== undefined)
      const marketFact = rankFact(marketPopulation, player, (item) => item.asset.value)
      const productionFact = player.asset.projectedPpg === undefined
        ? null
        : rankFact(productionPopulation, player, (item) => item.asset.projectedPpg ?? 0)
      const marketRank = marketFact.rank
      const productionRank = productionFact?.rank ?? null
      const marketPercentile = marketFact.percentile
      const productionPercentile = productionFact?.percentile ?? null
      const percentileGap = productionPercentile === null || productionPopulation.length < 2 || marketPopulation.length < 2
        ? null
        : Number(((productionPercentile - marketPercentile) * 100).toFixed(1))
      const ownerLikelyStarter = optimizeLineup(player.owner.players, options.rosterPositions).some((asset) => asset.id === player.asset.id)
      const ownerPositionCount = player.owner.players.filter((asset) => asset.position === player.asset.position).length
      const dedicatedSlots = options.rosterPositions.filter((position) => position === player.asset.position).length
      const direction = directionByRoster.get(player.owner.rosterId) ?? {
        rosterId: player.owner.rosterId,
        label: 'neutral' as const,
        manual: false,
        recentTrades: 0,
        playerValueFlow: 0,
        pickValueFlow: 0,
        reasons: ['No direction record supplied.'],
      }
      const tradeEvidence = evaluateTrade([], [player.asset], {
        teamA: mine,
        teamB: player.owner,
        rosterPositions: options.rosterPositions,
        horizonYears: options.strategy.horizonYears,
      })
      const ktc = positiveSource(player.asset.marketSources?.ktc)
      const fantasycalc = positiveSource(player.asset.marketSources?.fantasycalc)
      const ktcFact = ktc === null || fantasycalc === null || dualSourcePlayers.length < 2
        ? null
        : rankFact(dualSourcePlayers, player, (item) => positiveSource(item.asset.marketSources?.ktc) ?? 0)
      const fantasycalcFact = ktc === null || fantasycalc === null || dualSourcePlayers.length < 2
        ? null
        : rankFact(dualSourcePlayers, player, (item) => positiveSource(item.asset.marketSources?.fantasycalc) ?? 0)
      const sourcePercentileGap = ktcFact === null || fantasycalcFact === null
        ? null
        : Number((Math.abs(ktcFact.percentile - fantasycalcFact.percentile) * 100).toFixed(1))
      const market: MarketDislocation['market'] = {
        ktc,
        fantasycalc,
        ktcRank: ktcFact?.rank ?? null,
        fantasycalcRank: fantasycalcFact?.rank ?? null,
        population: dualSourcePlayers.length,
        ktcPercentile: ktcFact?.percentile ?? null,
        fantasycalcPercentile: fantasycalcFact?.percentile ?? null,
        percentileGap: sourcePercentileGap,
        higherRankSource: ktcFact === null || fantasycalcFact === null
          ? null
          : ktcFact.percentile === fantasycalcFact.percentile
            ? 'equal'
            : ktcFact.percentile > fantasycalcFact.percentile ? 'KTC' : 'FantasyCalc',
      }
      const production: MarketDislocation['production'] = {
        projectedPpg: player.asset.projectedPpg ?? null,
        marketRank,
        marketPopulation: marketPopulation.length,
        productionRank,
        productionPopulation: productionPopulation.length,
        marketPercentile,
        productionPercentile,
        percentileGap,
      }
      const pressure: MarketDislocation['pressure'] = {
        ownerLikelyStarter,
        ownerPositionCount,
        dedicatedSlots,
        countAboveDedicatedSlots: Math.max(0, ownerPositionCount - dedicatedSlots),
        myLineupDelta: tradeEvidence.lineupImpactA,
        ownerLineupLoss: tradeEvidence.lineupImpactB === null ? null : Math.max(0, -tradeEvidence.lineupImpactB),
        directionLabel: direction.label,
        directionManual: direction.manual,
        recentTrades: direction.recentTrades,
        playerValueFlow: direction.playerValueFlow,
        pickValueFlow: direction.pickValueFlow,
      }
      const horizon: MarketDislocation['horizon'] = {
        years: options.strategy.horizonYears,
        ageAtHorizon: player.asset.age === null || player.asset.age === undefined
          ? null
          : Number((player.asset.age + options.strategy.horizonYears).toFixed(1)),
      }
      const categories: DislocationCategory[] = []
      if (market.percentileGap !== null && market.percentileGap > 0) categories.push('market-gap')
      if (percentileGap !== null && percentileGap > 0) categories.push('production-ahead')
      if (!ownerLikelyStarter && ownerPositionCount > dedicatedSlots) categories.push('owner-depth')
      if (direction.recentTrades > 0) categories.push('active-trader')
      const candidate = { key: player.key, asset: player.asset, owner: player.owner, market, production, pressure, horizon, categories }
      return { ...candidate, frontier: false, evidence: evidenceFor(candidate) }
    })

  return candidates
    .map((candidate, index) => ({
      ...candidate,
      frontier: candidate.categories.length > 0 && !candidates.some((other, otherIndex) => (
        otherIndex !== index
        && other.categories.length > 0
        && dominates(other, candidate, options.strategy)
      )),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function nullableDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

/** Applies one explicit viewing lens. Ordering is lexicographic and stable;
 * it is not a weighted score shared across lenses. */
export function selectMarketDislocations(
  candidates: MarketDislocation[],
  lens: DislocationLens,
  limit = 12,
): MarketDislocation[] {
  const filtered = candidates.filter((candidate) => {
    if (lens === 'frontier') return candidate.frontier
    if (lens === 'market') return (candidate.market.percentileGap ?? 0) > 0
    if (lens === 'production') return (candidate.production.percentileGap ?? 0) > 0
    return candidate.categories.includes('owner-depth') || candidate.categories.includes('active-trader')
  })
  return [...filtered]
    .sort((left, right) => {
      if (lens === 'market') {
        return nullableDescending(left.market.percentileGap, right.market.percentileGap) || left.key.localeCompare(right.key)
      }
      if (lens === 'production') {
        return nullableDescending(left.production.percentileGap, right.production.percentileGap) || left.key.localeCompare(right.key)
      }
      if (lens === 'pressure') {
        return Number(left.pressure.ownerLikelyStarter) - Number(right.pressure.ownerLikelyStarter)
          || right.pressure.countAboveDedicatedSlots - left.pressure.countAboveDedicatedSlots
          || right.pressure.recentTrades - left.pressure.recentTrades
          || left.key.localeCompare(right.key)
      }
      return nullableDescending(left.market.percentileGap, right.market.percentileGap)
        || nullableDescending(left.production.percentileGap, right.production.percentileGap)
        || Number(left.pressure.ownerLikelyStarter) - Number(right.pressure.ownerLikelyStarter)
        || right.pressure.countAboveDedicatedSlots - left.pressure.countAboveDedicatedSlots
        || left.key.localeCompare(right.key)
    })
    .slice(0, Math.max(1, Math.min(500, limit)))
}
