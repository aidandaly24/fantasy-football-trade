import type { ManagerProfile } from './negotiation'
import { evaluateTrade } from './rankings'
import type { ResolvedTeamStrategy } from './strategy'
import type {
  Asset,
  EdgeOpportunitySnapshot,
  IntelSignal,
  MarketTapeAssetInput,
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
  /** Legacy storage fields. Zero means no calibrated probability is available. */
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

export type EdgeCategory = 'value' | 'points' | 'intel'

export type EdgeOpportunity = {
  key: string
  asset: Asset
  owner: Team
  categories: EdgeCategory[]
  lineupDelta: number
  catalyst: string
  thesis: string
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

function transactionTime(transaction: SleeperTransaction): number {
  return transaction.created < 10_000_000_000 ? transaction.created * 1000 : transaction.created
}

function pickCatalogValue(picks: PickValue[], season: string, round: number): number {
  const exact = picks.filter((pick) => pick.year === season && pick.round === round)
  const comparable = exact.length ? exact : picks.filter((pick) => pick.round === round)
  if (!comparable.length) return 0
  return comparable.reduce((sum, pick) => sum + pick.composite, 0) / comparable.length
}

/** Produces a visibly manual label or a simple current-roster descriptor. It does
 * not claim calibrated probabilities and no longer changes pick prices. */
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
    let playerValueFlow = 0
    let pickValueFlow = 0
    let recentTrades = 0
    options.transactions.forEach((transaction) => {
      if (!transaction.roster_ids.includes(team.rosterId) || nowMs - transactionTime(transaction) > lookbackMs) return
      recentTrades += 1
      Object.entries(transaction.adds ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId === team.rosterId) playerValueFlow += playerValues.get(playerId) ?? 0
      })
      Object.entries(transaction.drops ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId === team.rosterId) playerValueFlow -= playerValues.get(playerId) ?? 0
      })
      transaction.draft_picks.forEach((pick) => {
        const value = pickCatalogValue(options.picks, pick.season, pick.round)
        if (pick.owner_id === team.rosterId) pickValueFlow += value
        if (pick.previous_owner_id === team.rosterId) pickValueFlow -= value
      })
    })

    const override = options.overrides?.[String(team.rosterId)]
    const label = override ?? 'retooling'
    return {
      rosterId: team.rosterId,
      label,
      contenderProbability: 0,
      retoolingProbability: 0,
      rebuildingProbability: 0,
      confidence: 0,
      manual: Boolean(override),
      recentTrades,
      playerValueFlow: Math.round(playerValueFlow),
      pickValueFlow: Math.round(pickValueFlow),
      reasons: [
        override ? 'Manual league-knowledge label' : 'No manual label; neutral context only',
        recentTrades
          ? `${recentTrades} completed trade${recentTrades === 1 ? '' : 's'} in the selected lookback`
          : 'No completed trades in the selected lookback',
      ],
    }
  })
}

/** Kept for API compatibility. Direction labels are context only and cannot
 * reprice unresolved picks without a validated pick-outcome model. */
export function applyDirectionPickProjections(
  teams: Team[],
  _directions: TeamDirection[],
  _picks: PickValue[],
): Team[] {
  return teams
}

/** A factual evidence board. Current market value determines ordering. Linked
 * news is displayed as an unvalidated watch item and never moves price or rank. */
export function buildEdgeBoard(teams: Team[], options: EdgeBoardOptions): EdgeOpportunity[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  if (!mine) return []
  const directions = new Map(options.directions.map((direction) => [direction.rosterId, direction]))
  const intel = new Map((options.intelSignals ?? []).map((signal) => [String(signal.player.sleeperId), signal]))

  return teams
    .filter((team) => team.rosterId !== mine.rosterId)
    .flatMap((owner) => {
      const direction = directions.get(owner.rosterId)
      if (!direction) return []
      return [...owner.players, ...owner.picks]
        .filter((asset) => asset.value > 0)
        .map((asset): EdgeOpportunity => {
          const signal = asset.kind === 'player' ? intel.get(asset.id) ?? null : null
          const lineupDelta = asset.kind === 'player' && asset.projectedPpg !== undefined
            ? evaluateTrade([], [asset], { teamA: mine, teamB: owner, rosterPositions: options.rosterPositions }).lineupImpactA ?? 0
            : 0
          const categories: EdgeCategory[] = ['value']
          if (asset.kind === 'player' && asset.projectedPpg !== undefined) categories.push('points')
          if (signal) categories.push('intel')
          return {
            key: `${owner.rosterId}:${asset.id}`,
            asset,
            owner,
            categories,
            lineupDelta,
            catalyst: signal?.articles[0]?.title ?? 'No linked current report.',
            thesis: `${Math.round(asset.value).toLocaleString()} current composite market value${asset.projectedPpg === undefined ? '; no validated production projection' : `; ${asset.projectedPpg.toFixed(1)} modeled PPR points per team week`}.`,
            direction,
            intel: signal,
          }
        })
    })
    .sort((a, b) => b.asset.value - a.asset.value || a.key.localeCompare(b.key))
    .slice(0, options.maxResults ?? 24)
}

/** Saves raw daily observations. Projection fields are equal to the observed
 * value until a time-split model clears promotion gates. */
export function marketTapeAssets(
  teams: Team[],
  _directions: TeamDirection[],
  opportunities: EdgeOpportunity[],
  strategy: ResolvedTeamStrategy = { mode: 'retooling', horizonYears: 2, flipPriority: 0 },
): MarketTapeAssetInput[] {
  const opportunityByAsset = new Map(opportunities.map((opportunity) => [`${opportunity.owner.rosterId}:${opportunity.asset.id}`, opportunity]))
  const seen = new Set<string>()
  return teams.flatMap((team) => [...team.players, ...team.picks].flatMap((asset) => {
    const identity = `${team.rosterId}:${asset.id}`
    if (seen.has(identity)) return []
    seen.add(identity)
    const opportunity = opportunityByAsset.get(identity)
    const currentValue = Math.max(0, Math.round(asset.value))
    const sourceConfidence = Math.round(Math.max(0, Math.min(100, asset.confidence > 1 ? asset.confidence : asset.confidence * 100)))
    return [{
      assetId: asset.id,
      assetName: asset.name,
      kind: asset.kind,
      position: asset.position,
      ownerRosterId: team.rosterId,
      currentValue,
      projection30: currentValue,
      confidence: sourceConfidence,
      eventType: opportunity?.intel?.articles[0]?.eventType ?? 'none',
      newsDirection: opportunity?.intel?.direction ?? 'none',
      features: {
        ruleGain30: 0,
        ruleGain90: 0,
        edgeScore: 0,
        lineupDelta: opportunity?.lineupDelta ?? 0,
        catalystScore: 0,
        sellerFit: 0,
        liquidityScore: 0,
        timingScore: 0,
        uncertaintyPenalty: 0,
        confidence: sourceConfidence,
        age: asset.age ?? 0,
        contenderProbability: 0,
        rebuildingProbability: 0,
        profitScore: 0,
        resaleScore: 0,
        decayRisk: 0,
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

/** Legacy snapshot adapter. New live recommendations do not write these rows. */
export function opportunitySnapshot(
  opportunity: EdgeOpportunity,
  capturedAt = new Date().toISOString(),
): EdgeOpportunitySnapshot {
  const value = Math.round(opportunity.asset.value)
  return {
    snapshotKey: `${opportunity.key}:${capturedAt.slice(0, 10)}:${value}`,
    assetId: opportunity.asset.id,
    assetName: opportunity.asset.name,
    ownerRosterId: opportunity.owner.rosterId,
    capturedAt,
    currentValue: value,
    projection30: value,
    projection90: value,
    projection180: value,
    edgeScore: 0,
    lineupDelta: Number(opportunity.lineupDelta.toFixed(2)),
    confidence: 0,
    categories: opportunity.categories,
    catalyst: opportunity.catalyst,
    status: 'tracking',
  }
}

/** Reads old snapshot rows without treating them as current recommendations. */
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
