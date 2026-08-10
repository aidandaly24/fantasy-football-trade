import type { ManagerProfile } from './negotiation'
import { assetStability, evaluateTrade, scoreTeams } from './rankings'
import { assetStrategyMetrics, findTargets, resolveTeamStrategy, type ResolvedTeamStrategy } from './strategy'
import type {
  Asset,
  EdgeOpportunitySnapshot,
  IntelSignal,
  MarketTapeAssetInput,
  PickTier,
  PickValue,
  SleeperTransaction,
  Team,
  TeamStrategyProfile,
} from './types'

export type TeamDirectionLabel = 'contender' | 'retooling' | 'rebuilding'
export type TeamDirectionOverride = TeamDirectionLabel

export type TeamDirection = {
  rosterId: number
  label: TeamDirectionLabel
  contenderProbability: number
  retoolingProbability: number
  rebuildingProbability: number
  confidence: number
  manual: boolean
  recentTrades: number
  playerValueFlow: number
  pickValueFlow: number
  reasons: string[]
}

export type EdgeCategory = 'value' | 'flip' | 'points' | 'intel'

export type EdgeOpportunity = {
  key: string
  asset: Asset
  owner: Team
  score: number
  categories: EdgeCategory[]
  projectedValues: { day30: number; day90: number; day180: number }
  projectedGainPercent: number
  lineupDelta: number
  catalystScore: number
  sellerFit: number
  liquidityScore: number
  profitScore: number
  decayRisk: number
  projectedExitValue: number
  timingScore: number
  uncertaintyPenalty: number
  confidence: number
  openingPrice: number
  targetPrice: number
  walkAwayPrice: number
  catalyst: string
  thesis: string
  invalidation: string
  expiresAt: string
  direction: TeamDirection
  intel: IntelSignal | null
}

export type EdgeBoardOptions = {
  myRosterId: number
  rosterPositions: string[]
  directions: TeamDirection[]
  profiles: ManagerProfile[]
  intelSignals?: IntelSignal[]
  teamStrategy?: TeamStrategyProfile
  maxResults?: number
  now?: Date
}

export type OpportunityAttribution = {
  daysTracked: number
  currentValue: number
  valueChange: number
  valueChangePercent: number
  expectedValue: number
  expectedChangePercent: number
  status: 'too-early' | 'ahead' | 'on-track' | 'behind'
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const normalizedConfidence = (value: number) => clamp(value > 1 ? value : value * 100)

function transactionTime(transaction: SleeperTransaction): number {
  return transaction.created < 10_000_000_000 ? transaction.created * 1000 : transaction.created
}

function pickCatalogValue(picks: PickValue[], season: string, round: number): number {
  const exact = picks.filter((pick) => pick.year === season && pick.round === round)
  const comparable = exact.length ? exact : picks.filter((pick) => pick.round === round)
  if (!comparable.length) return Math.max(120, 520 / Math.pow(Math.max(1, round), 1.25))
  return comparable.reduce((sum, pick) => sum + pick.composite, 0) / comparable.length
}

function directionProbabilities(lean: number) {
  const bounded = Math.max(-1, Math.min(1, lean))
  const retoolingProbability = Math.max(0.12, Math.min(0.52, 0.52 - Math.abs(bounded) * 0.5))
  const directional = 1 - retoolingProbability
  const contenderProbability = directional * (0.5 + bounded * 0.5)
  const rebuildingProbability = 1 - retoolingProbability - contenderProbability
  return { contenderProbability, retoolingProbability, rebuildingProbability }
}

function manualDirection(rosterId: number, label: TeamDirectionLabel): TeamDirection {
  const probabilities = label === 'contender'
    ? { contenderProbability: 0.9, retoolingProbability: 0.08, rebuildingProbability: 0.02 }
    : label === 'rebuilding'
      ? { contenderProbability: 0.02, retoolingProbability: 0.08, rebuildingProbability: 0.9 }
      : { contenderProbability: 0.18, retoolingProbability: 0.64, rebuildingProbability: 0.18 }
  return {
    rosterId,
    label,
    ...probabilities,
    confidence: 96,
    manual: true,
    recentTrades: 0,
    playerValueFlow: 0,
    pickValueFlow: 0,
    reasons: ['Manual league-knowledge override'],
  }
}

/**
 * Infers a current competitive direction from roster shape and recent completed
 * trade flow. Manual league knowledge is explicit and always wins.
 */
export function buildTeamDirections(options: {
  teams: Team[]
  transactions: SleeperTransaction[]
  picks: PickValue[]
  overrides?: Record<string, TeamDirectionOverride>
  now?: Date
  lookbackDays?: number
}): TeamDirection[] {
  const nowMs = (options.now ?? new Date()).getTime()
  const lookbackMs = (options.lookbackDays ?? 180) * 86_400_000
  const playerValues = new Map(options.teams.flatMap((team) => team.players.map((asset) => [asset.id, asset.value] as const)))

  return options.teams.map((team) => {
    const override = options.overrides?.[String(team.rosterId)]
    if (override) return manualDirection(team.rosterId, override)

    let playerValueFlow = 0
    let pickValueFlow = 0
    let activityValue = 0
    let recentTrades = 0
    options.transactions.forEach((transaction) => {
      if (!transaction.roster_ids.includes(team.rosterId)) return
      const ageMs = Math.max(0, nowMs - transactionTime(transaction))
      if (ageMs > lookbackMs) return
      const ageDays = ageMs / 86_400_000
      const recency = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.72 : 0.42
      recentTrades += 1
      Object.entries(transaction.adds ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId !== team.rosterId) return
        const value = playerValues.get(playerId) ?? 0
        playerValueFlow += value * recency
        activityValue += value * recency
      })
      Object.entries(transaction.drops ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId !== team.rosterId) return
        const value = playerValues.get(playerId) ?? 0
        playerValueFlow -= value * recency
        activityValue += value * recency
      })
      transaction.draft_picks.forEach((pick) => {
        const value = pickCatalogValue(options.picks, pick.season, pick.round) * recency
        if (pick.owner_id === team.rosterId) {
          pickValueFlow += value
          activityValue += value
        }
        if (pick.previous_owner_id === team.rosterId) {
          pickValueFlow -= value
          activityValue += value
        }
      })
    })

    const rosterLean = Math.max(-1, Math.min(1, (team.metrics.contender - team.metrics.future) / 45))
    const flowLean = activityValue
      ? Math.max(-1, Math.min(1, (playerValueFlow - pickValueFlow) / activityValue))
      : 0
    const activityWeight = Math.min(0.68, recentTrades * 0.3)
    const lean = rosterLean * (1 - activityWeight) + flowLean * activityWeight
    const probabilities = directionProbabilities(lean)
    const label: TeamDirectionLabel = lean >= 0.14 ? 'contender' : lean <= -0.14 ? 'rebuilding' : 'retooling'
    const confidence = Math.round(clamp(
      38 + Math.abs(lean) * 30 + Math.min(24, recentTrades * 6) + Math.abs(team.metrics.contender - team.metrics.future) * 0.18,
      35,
      91,
    ))
    const reasons = [
      `${team.metrics.contender >= team.metrics.future ? 'Current lineup' : 'Two-year base'} leads roster profile`,
      recentTrades
        ? `${recentTrades} recent trade${recentTrades === 1 ? '' : 's'}: ${Math.round(playerValueFlow) >= 0 ? '+' : ''}${Math.round(playerValueFlow)} player value, ${Math.round(pickValueFlow) >= 0 ? '+' : ''}${Math.round(pickValueFlow)} pick value`
        : 'No recent completed-trade signal',
    ]
    return {
      rosterId: team.rosterId,
      label,
      ...probabilities,
      confidence,
      manual: false,
      recentTrades,
      playerValueFlow: Math.round(playerValueFlow),
      pickValueFlow: Math.round(pickValueFlow),
      reasons,
    }
  })
}

function averageTierValue(picks: PickValue[], year: string, round: number, tier: PickTier): number | null {
  const exact = picks.filter((pick) => pick.year === year && pick.round === round && pick.tier === tier)
  const comparable = exact.length ? exact : picks.filter((pick) => pick.round === round && pick.tier === tier)
  return comparable.length ? comparable.reduce((sum, pick) => sum + pick.composite, 0) / comparable.length : null
}

/** Reprices unresolved future picks from the originating team's live direction. */
export function applyDirectionPickProjections(
  teams: Team[],
  directions: TeamDirection[],
  picks: PickValue[],
): Team[] {
  const directionByRoster = new Map(directions.map((direction) => [direction.rosterId, direction]))
  const projected = teams.map((team) => ({
    ...team,
    picks: team.picks.map((asset) => {
      if (asset.kind !== 'pick' || !asset.year || !asset.round || !asset.originalRosterId || asset.projectedTier === 'known') return asset
      const direction = directionByRoster.get(asset.originalRosterId)
      if (!direction) return asset
      const probabilities: Record<PickTier, number> = {
        early: direction.rebuildingProbability * 0.6 + direction.retoolingProbability * 0.25 + direction.contenderProbability * 0.12,
        mid: direction.rebuildingProbability * 0.28 + direction.retoolingProbability * 0.5 + direction.contenderProbability * 0.28,
        late: direction.rebuildingProbability * 0.12 + direction.retoolingProbability * 0.25 + direction.contenderProbability * 0.6,
      }
      const fallback = asset.value
      const value = (['early', 'mid', 'late'] as const).reduce(
        (sum, tier) => sum + (averageTierValue(picks, asset.year!, asset.round!, tier) ?? fallback) * probabilities[tier],
        0,
      )
      const projectedTier = (Object.entries(probabilities) as Array<[PickTier, number]>)
        .sort((a, b) => b[1] - a[1])[0][0]
      return {
        ...asset,
        value: Math.round(value),
        valueLow: Math.min(...(['early', 'mid', 'late'] as const).map((tier) => averageTierValue(picks, asset.year!, asset.round!, tier) ?? fallback)),
        valueHigh: Math.max(...(['early', 'mid', 'late'] as const).map((tier) => averageTierValue(picks, asset.year!, asset.round!, tier) ?? fallback)),
        projectedTier,
        tierProbabilities: probabilities,
        projectionConfidence: direction.confidence / 100,
      }
    }),
  }))
  return scoreTeams(projected)
}

function futureGain(asset: Asset, signal: IntelSignal | null): number {
  let gain = 0
  if (signal?.direction === 'up') gain += Math.min(0.17, signal.edgeScore / 520)
  if (signal?.direction === 'down') gain -= Math.min(0.14, signal.impactScore / 620)
  if (asset.kind === 'pick') return Math.max(-0.04, Math.min(0.08, gain))
  const age = asset.age ?? 27
  const ascending = asset.position === 'QB' ? age <= 27 : asset.position === 'RB' ? age <= 23 : age <= 24
  if (ascending) gain += 0.025
  if (asset.position === 'RB' && age >= 27) gain -= 0.055
  if ((asset.position === 'WR' || asset.position === 'TE') && age >= 30) gain -= 0.04
  if (asset.position === 'QB' && age >= 35) gain -= 0.03
  if (asset.depthChartOrder === 1) gain += 0.018
  if ((asset.depthChartOrder ?? 1) >= 3) gain -= 0.04
  if (asset.active === false) gain -= 0.1
  if (asset.injuryStatus && !/^healthy$/i.test(asset.injuryStatus)) gain -= 0.035
  return Math.max(-0.2, Math.min(0.25, gain))
}

function expiryFor(signal: IntelSignal | null, now: Date): string {
  const expiries = signal?.articles.map((article) => article.expiresAt).filter((value): value is string => Boolean(value)) ?? []
  if (expiries.length) return expiries.sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return new Date(now.getTime() + 7 * 86_400_000).toISOString()
}

function managerSellerFit(profile: ManagerProfile | undefined): number {
  if (!profile?.tradeCount) return 45
  return clamp(42 + Math.min(25, profile.tradeCount * 2) + (profile.confidence === 'high' ? 12 : profile.confidence === 'medium' ? 7 : 0))
}

/** Scans all counterpart rosters and emits one auditable, deterministic opportunity board. */
export function buildEdgeBoard(teams: Team[], options: EdgeBoardOptions): EdgeOpportunity[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  if (!mine) return []
  const strategy = resolveTeamStrategy(mine, options.teamStrategy)
  const now = options.now ?? new Date()
  const directions = new Map(options.directions.map((direction) => [direction.rosterId, direction]))
  const profiles = new Map(options.profiles.map((profile) => [profile.rosterId, profile]))
  const intel = new Map((options.intelSignals ?? []).map((signal) => [String(signal.player.sleeperId), signal]))
  const opportunities: EdgeOpportunity[] = []

  teams.filter((team) => team.rosterId !== mine.rosterId).forEach((owner) => {
    const direction = directions.get(owner.rosterId)
    if (!direction) return
    const candidates = findTargets(teams, {
      myRosterId: mine.rosterId,
      counterpartRosterId: owner.rosterId,
      rosterPositions: options.rosterPositions,
      maxTargets: 20,
      teamStrategy: options.teamStrategy,
    })
    candidates.forEach((candidate) => {
      const asset = candidate.asset
      const signal = asset.kind === 'player' ? intel.get(asset.id) ?? null : null
      const lineupDelta = evaluateTrade([], [asset], { teamA: mine, teamB: owner, rosterPositions: options.rosterPositions }).lineupImpactA ?? 0
      const directionFit = asset.kind === 'pick'
        ? direction.contenderProbability * 100
        : direction.rebuildingProbability * (asset.age && asset.age >= 27 ? 100 : 76) + direction.retoolingProbability * 42
      const sellerFit = Math.round(clamp(candidate.availabilityScore * 0.5 + directionFit * 0.28 + managerSellerFit(profiles.get(owner.rosterId)) * 0.22))
      const gain = futureGain(asset, signal)
      const futureScore = clamp(50 + gain * 220)
      const pointsScore = clamp(42 + lineupDelta * 11)
      const catalystScore = signal?.direction === 'up'
        ? signal.edgeScore
        : signal?.direction === 'down'
          ? clamp(35 - signal.impactScore * 0.3)
          : signal
            ? signal.edgeScore * 0.5
            : 12
      const strategyMetrics = assetStrategyMetrics(asset, strategy)
      const liquidityScore = Math.round(strategyMetrics.liquidityScore)
      const timingScore = signal ? clamp(signal.freshnessScore * 0.65 + (100 - signal.marketReactionScore) * 0.35) : 20
      const uncertaintyPenalty = Math.round(clamp(candidate.uncertaintyPenalty * 0.72 + (100 - direction.confidence) * 0.28))
      const score = Math.round(strategy.mode === 'rebuilding'
        ? clamp(
          strategyMetrics.profitScore * 0.3
          + strategyMetrics.liquidityScore * 0.2
          + futureScore * 0.18
          + sellerFit * 0.14
          + catalystScore * 0.1
          + timingScore * 0.08
          + pointsScore * 0.02
          - uncertaintyPenalty * 0.14
          - strategyMetrics.decayRisk * 0.2,
        )
        : clamp(
          futureScore * 0.35
          + pointsScore * 0.2
          + catalystScore * 0.15
          + sellerFit * 0.15
          + liquidityScore * 0.1
          + timingScore * 0.05
          - uncertaintyPenalty * 0.15,
        ))
      const categories: EdgeCategory[] = []
      if (gain >= 0.045) categories.push('value')
      if (strategyMetrics.profitScore >= 68 && strategyMetrics.decayRisk < 55) categories.push('flip')
      if (lineupDelta >= 1) categories.push('points')
      if (signal && signal.edgeScore >= 35) categories.push('intel')
      if (!categories.length) categories.push(lineupDelta > 0 ? 'points' : 'value')
      const projectedValues = {
        day30: Math.round(asset.value * (1 + gain * 0.45)),
        day90: Math.round(asset.value * (1 + gain)),
        day180: Math.round(asset.value * (1 + gain * 1.25)),
      }
      const confidence = Math.round(clamp(
        normalizedConfidence(asset.confidence) * 0.38
        + direction.confidence * 0.24
        + (signal?.confidence ?? 45) * 0.28
        + (100 - uncertaintyPenalty) * 0.1,
      ))
      const catalyst = signal?.articles[0]?.title
        ?? `${owner.teamName} is ${Math.round(Math.max(direction.contenderProbability, direction.rebuildingProbability, direction.retoolingProbability) * 100)}% ${direction.label} with ${candidate.availabilityScore}/100 target availability.`
      const thesis = signal
        ? `${signal.rationale} ${owner.teamName}'s ${direction.label} direction creates a ${sellerFit}/100 seller fit.`
        : strategy.mode === 'rebuilding'
          ? `${asset.name} has ${strategyMetrics.profitScore.toFixed(0)}/100 profit potential, ${strategyMetrics.liquidityScore.toFixed(0)}/100 resale liquidity, and ${strategyMetrics.decayRisk.toFixed(0)}/100 age-decay risk over the ${strategy.horizonYears}-year window.`
          : `${asset.name} adds ${lineupDelta >= 0 ? '+' : ''}${lineupDelta.toFixed(1)} projected weekly points and fits a ${direction.label} seller.`
      const invalidation = signal
        ? 'Price absorbs the report, the role signal reverses, or the seller asks above the walk-away value.'
        : 'Owner direction changes, lineup utility falls, or the acquisition price clears the walk-away value.'
      opportunities.push({
        key: `${owner.rosterId}:${asset.id}`,
        asset,
        owner,
        score,
        categories,
        projectedValues,
        projectedGainPercent: gain,
        lineupDelta,
        catalystScore,
        sellerFit,
        liquidityScore,
        profitScore: Math.round(strategyMetrics.profitScore),
        decayRisk: Math.round(strategyMetrics.decayRisk),
        projectedExitValue: strategyMetrics.projectedExitValue,
        timingScore: Math.round(timingScore),
        uncertaintyPenalty,
        confidence,
        openingPrice: Math.round(asset.value * (strategy.mode === 'rebuilding' ? 0.82 : gain < 0 ? 0.78 : 0.88)),
        targetPrice: Math.round(asset.value * (strategy.mode === 'rebuilding' ? 0.94 : gain < 0 ? 0.88 : 0.97)),
        walkAwayPrice: Math.round(strategy.mode === 'rebuilding'
          ? Math.min(asset.value, strategyMetrics.projectedExitValue * 0.92)
          : Math.min(asset.value * (gain < 0 ? 0.92 : 1.06), projectedValues.day90 * 0.98)),
        catalyst,
        thesis,
        invalidation,
        expiresAt: expiryFor(signal, now),
        direction,
        intel: signal,
      })
    })
  })

  return opportunities
    .sort((a, b) => b.score - a.score || b.projectedGainPercent - a.projectedGainPercent || b.lineupDelta - a.lineupDelta || a.key.localeCompare(b.key))
    .slice(0, options.maxResults ?? 24)
}

/** Captures every rostered asset, including controls that were not recommended. */
export function marketTapeAssets(
  teams: Team[],
  directions: TeamDirection[],
  opportunities: EdgeOpportunity[],
  strategy: ResolvedTeamStrategy = { mode: 'retooling', horizonYears: 2, flipPriority: 0.6 },
): MarketTapeAssetInput[] {
  const directionByRoster = new Map(directions.map((direction) => [direction.rosterId, direction]))
  const opportunityByAsset = new Map(opportunities.map((opportunity) => [`${opportunity.owner.rosterId}:${opportunity.asset.id}`, opportunity]))
  const seen = new Set<string>()
  return teams.flatMap((team) => [...team.players, ...team.picks].flatMap((asset) => {
    const identity = `${team.rosterId}:${asset.id}`
    if (seen.has(identity)) return []
    seen.add(identity)
    const opportunity = opportunityByAsset.get(identity)
    const direction = directionByRoster.get(team.rosterId)
    const currentValue = Math.max(0, Math.round(asset.value))
    const projection30 = opportunity?.projectedValues.day30 ?? currentValue
    const strategyMetrics = assetStrategyMetrics(asset, strategy)
    return [{
      assetId: asset.id,
      assetName: asset.name,
      kind: asset.kind,
      position: asset.position,
      ownerRosterId: team.rosterId,
      currentValue,
      projection30,
      confidence: Math.round(normalizedConfidence(asset.confidence)),
      eventType: opportunity?.intel?.articles[0]?.eventType ?? 'none',
      newsDirection: opportunity?.intel?.direction ?? 'none',
      features: {
        ruleGain30: currentValue ? (projection30 - currentValue) / currentValue : 0,
        ruleGain90: currentValue && opportunity ? (opportunity.projectedValues.day90 - currentValue) / currentValue : 0,
        edgeScore: opportunity?.score ?? 0,
        lineupDelta: opportunity?.lineupDelta ?? 0,
        catalystScore: opportunity?.catalystScore ?? 0,
        sellerFit: opportunity?.sellerFit ?? 0,
        liquidityScore: opportunity?.liquidityScore ?? Math.round(assetStability(asset) * 100),
        timingScore: opportunity?.timingScore ?? 0,
        uncertaintyPenalty: opportunity?.uncertaintyPenalty ?? Math.round((1 - normalizedConfidence(asset.confidence) / 100) * 100),
        confidence: opportunity?.confidence ?? Math.round(normalizedConfidence(asset.confidence)),
        age: asset.age ?? (asset.kind === 'pick' ? 0 : 27),
        contenderProbability: direction?.contenderProbability ?? 0.33,
        rebuildingProbability: direction?.rebuildingProbability ?? 0.33,
        profitScore: opportunity?.profitScore ?? Math.round(strategyMetrics.profitScore),
        resaleScore: opportunity?.liquidityScore ?? Math.round(strategyMetrics.liquidityScore),
        decayRisk: opportunity?.decayRisk ?? Math.round(strategyMetrics.decayRisk),
        horizonYears: strategy.horizonYears,
      },
      metadata: {
        year: asset.year,
        round: asset.round,
        slot: asset.slot,
        projectedTier: asset.projectedTier,
      },
    }]
  }))
}

export function opportunitySnapshot(
  opportunity: EdgeOpportunity,
  capturedAt = new Date().toISOString(),
): EdgeOpportunitySnapshot {
  return {
    snapshotKey: `${opportunity.key}:${capturedAt.slice(0, 10)}:${opportunity.score}:${opportunity.projectedValues.day90}`,
    assetId: opportunity.asset.id,
    assetName: opportunity.asset.name,
    ownerRosterId: opportunity.owner.rosterId,
    capturedAt,
    currentValue: Math.round(opportunity.asset.value),
    projection30: opportunity.projectedValues.day30,
    projection90: opportunity.projectedValues.day90,
    projection180: opportunity.projectedValues.day180,
    edgeScore: opportunity.score,
    lineupDelta: Number(opportunity.lineupDelta.toFixed(2)),
    confidence: opportunity.confidence,
    categories: opportunity.categories,
    catalyst: opportunity.catalyst,
    status: 'tracking',
  }
}

export function attributeOpportunity(
  snapshot: EdgeOpportunitySnapshot,
  currentValue: number,
  now = new Date(),
): OpportunityAttribution {
  const daysTracked = Math.max(0, Math.floor((now.getTime() - Date.parse(snapshot.capturedAt)) / 86_400_000))
  const expectedValue = daysTracked >= 180
    ? snapshot.projection180
    : daysTracked >= 90
      ? snapshot.projection90
      : snapshot.projection30
  const valueChange = currentValue - snapshot.currentValue
  const valueChangePercent = snapshot.currentValue ? valueChange / snapshot.currentValue : 0
  const expectedChangePercent = snapshot.currentValue ? (expectedValue - snapshot.currentValue) / snapshot.currentValue : 0
  const gap = valueChangePercent - expectedChangePercent
  const status: OpportunityAttribution['status'] = daysTracked < 7
    ? 'too-early'
    : gap >= 0.03
      ? 'ahead'
      : gap >= -0.04
        ? 'on-track'
        : 'behind'
  return { daysTracked, currentValue, valueChange, valueChangePercent, expectedValue, expectedChangePercent, status }
}
