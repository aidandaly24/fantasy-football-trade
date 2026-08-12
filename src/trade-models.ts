import type { LeagueContext } from './league-context'
import type { Asset, Team } from './types'

export type TradeModelStatus = 'needs-data' | 'shadow' | 'validated'

export type TradeTapeRefreshState = {
  source: 'FantasyCalc completed trades'
  status: 'never-refreshed' | 'refreshing' | 'ready' | 'partial' | 'failed'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  totalTrades: number
  uniqueLeagues: number
  firstTradeAt: string | null
  latestTradeAt: string | null
  latestRun: {
    anchorsAttempted: number
    anchorsSucceeded: number
    tradesDiscovered: number
    newTrades: number
    errors: string[]
  } | null
}

export type TradeTrainingManifest = {
  schemaVersion: number
  datasetId: string
  source: string
  exportedAt: string
  totalTrades: number
  uniqueLeagues: number
  firstTradeAt: string | null
  latestTradeAt: string | null
  pointInTimeValuedTrades: number
  historyAssetCount: number
  datasetIds?: string[]
  importedTrades?: number
  localCacheTrades?: number
  pointInTimeCoverage?: number
  importedPointInTimeValuedTrades?: number
  importedPointInTimeCoverage?: number
  historySeriesCount?: number
}

export type TradeEvidenceStage = {
  id: 'collected' | 'valued' | 'trained' | 'validated' | 'influencing'
  label: string
  status: 'ready' | 'partial' | 'blocked' | 'inactive'
  detail: string
}

export type TradeModelGate = {
  id: string
  label: string
  passed: boolean
  actual: number
  requirement: string
}

export type PortableRidgeModel = {
  kind: 'standardized-ridge-v1'
  features: string[]
  means: number[]
  scales: number[]
  coefficients: number[]
  intercept: number
}

export type TradeModelMetrics = { mae: number; rmse: number }

export type ExchangeSegment = {
  dimension: string
  label: string
  rows: number
  medianPremium: number
  p25Premium: number
  p75Premium: number
}

export type ExchangePremiumHealth = {
  status: TradeModelStatus
  enabled: boolean
  target: string
  rows: number
  trainingRows: number
  testRows: number
  dateSpanDays: number
  uniqueLeagues: number
  medianPremium: number | null
  baseline: TradeModelMetrics
  modelMetrics: TradeModelMetrics
  maeImprovement: number
  model: PortableRidgeModel | null
  segments: ExchangeSegment[]
  gates: TradeModelGate[]
}

export type OutcomeVariantHealth = {
  metrics: TradeModelMetrics
  model: PortableRidgeModel | null
  maeImprovement?: number
  maeImprovementVsStructure?: number
}

export type TradeOutcomeHealth = {
  status: TradeModelStatus
  enabled: boolean
  horizonDays: 90 | 180 | 365
  target: string
  rows: number
  trainingRows: number
  testRows: number
  baseline: TradeModelMetrics
  structureOnly: OutcomeVariantHealth
  premiumAware: OutcomeVariantHealth
  gates: TradeModelGate[]
}

export type TradeModelHealthBundle = {
  generatedAt: string
  trainingManifest?: TradeTrainingManifest
  source: {
    name: string
    methodology: string
    terms: string
    acceptedTradesOnly: boolean
    warning: string
    historicalFormatWarning?: string
  }
  rawTradeCount: number
  historyAssetCount: number
  exchange: ExchangePremiumHealth
  outcomes: TradeOutcomeHealth[]
  lineupOutcome: {
    status: TradeModelStatus
    enabled: boolean
    target: string
    rows: number
    reason: string
  }
}

export type TradeModelWeights = {
  market: number
  lineup: number
  exchange: number
  outcome: number
  outcomeHorizon: 90 | 180 | 365
  outcomeVariant: 'structureOnly' | 'premiumAware'
}

export const DEFAULT_TRADE_MODEL_WEIGHTS: TradeModelWeights = {
  market: 100,
  lineup: 0,
  exchange: 0,
  outcome: 0,
  outcomeHorizon: 180,
  outcomeVariant: 'premiumAware',
}

export type ConsolidationStructure = {
  eliteAsset: Asset
  packageAssets: Asset[]
  eliteAcquirer: 'A' | 'B'
  elitePercentile: number
  eligible: boolean
  actualPremium: number
  featureValues: Record<string, number>
}

export type TradeModelSignals = {
  market: number | null
  lineup: number | null
  exchange: number | null
  outcome: number | null
}

export type WeightedTradeEvidence = {
  coveredSignal: number | null
  weightCoverage: number
  complete: boolean
  requestedWeight: number
  availableWeight: number
  contributions: Array<{
    id: keyof Pick<TradeModelWeights, 'market' | 'lineup' | 'exchange' | 'outcome'>
    weight: number
    signal: number | null
    contribution: number | null
  }>
}

export function buildHistoricalTradeEvidenceStages(
  tape: TradeTapeRefreshState | null,
  health: TradeModelHealthBundle | null,
  weighted: WeightedTradeEvidence,
): TradeEvidenceStage[] {
  const manifest = health?.trainingManifest
  const historicalContributions = weighted.contributions.filter((item) => item.id === 'exchange' || item.id === 'outcome')
  const activeHistorical = historicalContributions.filter((item) => item.weight > 0 && item.contribution !== null)
  const validatedModels = Number(Boolean(health?.exchange.enabled)) + (health?.outcomes.filter((item) => item.enabled).length ?? 0)
  return [
    {
      id: 'collected',
      label: 'Collected',
      status: tape?.totalTrades ? (tape.status === 'ready' ? 'ready' : 'partial') : 'inactive',
      detail: tape?.totalTrades
        ? `${tape.totalTrades} completed trades saved from ${tape.uniqueLeagues} leagues.`
        : 'No hosted completed-trade tape is saved yet.',
    },
    {
      id: 'valued',
      label: 'Historically valued',
      status: manifest?.pointInTimeValuedTrades ? 'ready' : 'blocked',
      detail: manifest
        ? `${manifest.pointInTimeValuedTrades}/${manifest.totalTrades} training trades valued${manifest.importedTrades ? `; ${manifest.importedPointInTimeValuedTrades ?? 0}/${manifest.importedTrades} from the hosted export` : ''} · dataset ${manifest.datasetId.slice(0, 20)}…`
        : 'The shipped artifact does not identify a hosted-tape dataset or point-in-time join.',
    },
    {
      id: 'trained',
      label: 'Trained',
      status: health?.exchange.rows ? 'ready' : 'blocked',
      detail: health?.exchange.rows
        ? `${health.exchange.rows} eligible exchange rows in the artifact dated ${new Date(health.generatedAt).toLocaleDateString()}.`
        : 'No eligible historical exchange rows are in the shipped artifact.',
    },
    {
      id: 'validated',
      label: 'Validated',
      status: validatedModels ? 'ready' : 'blocked',
      detail: validatedModels
        ? `${validatedModels} historical model${validatedModels === 1 ? '' : 's'} passed every declared held-out gate.`
        : 'No historical model has passed every sample, span, coverage, and held-out performance gate.',
    },
    {
      id: 'influencing',
      label: 'Influencing this trade',
      status: activeHistorical.length ? 'ready' : 'inactive',
      detail: activeHistorical.length
        ? `${activeHistorical.map((item) => item.id).join(' and ')} evidence contributes to the weighted direction.`
        : 'No exchange-premium or future-outcome evidence contributes to this trade.',
    },
  ]
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function percentile(values: number[], target: number): number {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!usable.length) return 0
  let index = 0
  while (index < usable.length && usable[index] <= target) index += 1
  return index / usable.length
}

function boundedWeight(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

export function buildConsolidationStructure(options: {
  sideA: Asset[]
  sideB: Asset[]
  teamA: Team
  teamB: Team
  marketPopulation: number[]
  leagueContext: LeagueContext
}): ConsolidationStructure | null {
  const { sideA, sideB, teamA, teamB, marketPopulation, leagueContext } = options
  const shape = [sideA.length, sideB.length].sort((a, b) => a - b)
  if (shape[0] !== 1 || ![2, 3].includes(shape[1])) return null
  const eliteAsset = sideA.length === 1 ? sideA[0] : sideB[0]
  const packageAssets = sideA.length === 1 ? sideB : sideA
  const eliteAcquirer = sideA.length === 1 ? 'B' : 'A'
  const eliteValue = eliteAsset.value
  const packageValue = packageAssets.reduce((sum, asset) => sum + asset.value, 0)
  if (eliteValue <= 0) return null
  const elitePercentile = percentile(marketPopulation, eliteValue)
  const eliteAge = eliteAsset.age ?? 0
  const packageAges = packageAssets.flatMap((asset) => asset.age === null ? [] : [asset.age])
  const rosterSize = average([teamA.players.length, teamB.players.length])
  const starters = leagueContext.roster.skillStartingSlots
  const featureValues = {
    elite_percentile: elitePercentile,
    package_size: packageAssets.length,
    pick_count: packageAssets.filter((asset) => asset.kind === 'pick').length,
    elite_is_pick: eliteAsset.kind === 'pick' ? 1 : 0,
    elite_age: eliteAge,
    elite_age_missing: eliteAsset.age === null ? 1 : 0,
    package_average_age: average(packageAges),
    package_age_missing: packageAges.length ? 0 : 1,
    num_teams: leagueContext.marketFormat.numTeams,
    num_qbs: leagueContext.marketFormat.numQbs,
    ppr: leagueContext.scoring.receptionPpr,
    te_premium: leagueContext.scoring.tePremiumPerReception,
    roster_size: rosterSize,
    starter_count: starters,
    depth_ratio: starters ? rosterSize / starters : 0,
    paid_premium: packageValue / eliteValue - 1,
  }
  return {
    eliteAsset,
    packageAssets,
    eliteAcquirer,
    elitePercentile,
    eligible: elitePercentile >= 0.70 && eliteValue >= Math.max(...packageAssets.map((asset) => asset.value)),
    actualPremium: featureValues.paid_premium,
    featureValues,
  }
}

export function predictPortableModel(model: PortableRidgeModel | null, features: Record<string, number>): number | null {
  if (!model || model.features.length !== model.coefficients.length) return null
  return model.features.reduce((prediction, feature, index) => {
    const scale = model.scales[index] || 1
    const standardized = ((features[feature] ?? 0) - (model.means[index] ?? 0)) / scale
    return prediction + standardized * model.coefficients[index]
  }, model.intercept)
}

export function modelSignalsForTrade(options: {
  rawMarketPercent: number | null
  lineupPercent: number | null
  structure: ConsolidationStructure | null
  health: TradeModelHealthBundle | null
  weights: TradeModelWeights
}): TradeModelSignals {
  const { structure, health, weights } = options
  if (!structure || !structure.eligible || !health) {
    return { market: options.rawMarketPercent, lineup: options.lineupPercent, exchange: null, outcome: null }
  }
  const orientation = structure.eliteAcquirer === 'A' ? 1 : -1
  const typicalPremium = health.exchange.enabled
    ? predictPortableModel(health.exchange.model, structure.featureValues)
    : null
  const outcome = health.outcomes.find((item) => item.horizonDays === weights.outcomeHorizon)
  const outcomeModel = outcome?.enabled ? outcome[weights.outcomeVariant].model : null
  const outcomePrediction = predictPortableModel(outcomeModel, structure.featureValues)
  return {
    market: options.rawMarketPercent,
    lineup: options.lineupPercent,
    exchange: typicalPremium === null ? null : orientation * (typicalPremium - structure.actualPremium) * 100,
    outcome: outcomePrediction === null ? null : orientation * outcomePrediction * 100,
  }
}

export function weightTradeEvidence(signals: TradeModelSignals, weights: TradeModelWeights): WeightedTradeEvidence {
  const ids: Array<keyof TradeModelSignals> = ['market', 'lineup', 'exchange', 'outcome']
  const requestedWeight = ids.reduce((sum, id) => sum + boundedWeight(weights[id]), 0)
  const contributions = ids.map((id) => {
    const weight = boundedWeight(weights[id])
    const signal = signals[id]
    return { id, weight, signal, contribution: signal === null || weight === 0 ? null : signal * weight }
  })
  const available = contributions.filter((item) => item.signal !== null && item.weight > 0)
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0)
  const coveredSignal = availableWeight
    ? available.reduce((sum, item) => sum + (item.contribution ?? 0), 0) / availableWeight
    : null
  return {
    coveredSignal,
    weightCoverage: requestedWeight ? availableWeight / requestedWeight : 0,
    complete: requestedWeight > 0 && availableWeight === requestedWeight,
    requestedWeight,
    availableWeight,
    contributions,
  }
}
