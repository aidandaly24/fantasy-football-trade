import type {
  EdgeCalibrationGroup,
  EdgeFeatureVector,
  EdgeShadowModelHealth,
  EdgeShadowPrediction,
  MarketTapeAssetInput,
} from './types'

const DAY_MS = 86_400_000
const MODEL_VERSION = 'edge-return-ridge-v5.0-shadow'
const MIN_TRAIN_ROWS = 160
const MIN_VALIDATION_ROWS = 40
const MIN_UNIQUE_ASSETS = 75
const MIN_SPAN_DAYS = 60
const MIN_MAE_LIFT = 0.05
const MIN_RANK_DELTA = -0.01

export type MarketSnapshotRecord = MarketTapeAssetInput & {
  snapshotDate: string
  capturedAt: string
  sourceVersion: string
}

export type EdgeTrainingExample = {
  assetId: string
  assetName: string
  position: MarketTapeAssetInput['position']
  kind: MarketTapeAssetInput['kind']
  eventType: string
  newsDirection: MarketTapeAssetInput['newsDirection']
  capturedAt: string
  outcomeAt: string
  currentValue: number
  outcomeValue: number
  actualReturn: number
  ruleReturn: number
  features: EdgeFeatureVector
}

export type EdgeShadowArtifact = {
  version: string
  featureNames: string[]
  featureMeans: number[]
  featureScales: number[]
  weights: number[]
  bias: number
}

export type EdgeLearningReport = {
  health: EdgeShadowModelHealth
  calibration: EdgeCalibrationGroup[]
  artifact: EdgeShadowArtifact | null
  examples: EdgeTrainingExample[]
}

const FEATURE_NAMES = [
  'logCurrentValue',
  'lineupDelta',
  'sourceConfidence',
  'age',
  'horizonYears',
  'isPick',
  'isQB',
  'isRB',
  'isWR',
  'isTE',
] as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY_MS
}

function valuesFor(input: Pick<MarketSnapshotRecord, 'currentValue' | 'features' | 'kind' | 'position'>): number[] {
  const features = input.features
  return [
    Math.log1p(Math.max(0, input.currentValue)) / 10,
    clamp(features.lineupDelta / 10, -2, 2),
    features.confidence / 100,
    clamp((features.age - 25) / 10, -1.5, 2),
    clamp(((features.horizonYears ?? 2) - 1) / 3, 0, 1),
    input.kind === 'pick' ? 1 : 0,
    input.position === 'QB' ? 1 : 0,
    input.position === 'RB' ? 1 : 0,
    input.position === 'WR' ? 1 : 0,
    input.position === 'TE' ? 1 : 0,
  ]
}

/**
 * Builds non-overlapping-enough 30-day labels from the private market tape.
 * Each asset contributes at most one anchor every 21 days, which prevents a
 * daily tape from masquerading as dozens of independent examples.
 */
export function labelMarketSnapshots(
  snapshots: MarketSnapshotRecord[],
  horizonDays = 30,
  toleranceDays = 7,
  anchorSpacingDays = 21,
): EdgeTrainingExample[] {
  const grouped = new Map<string, MarketSnapshotRecord[]>()
  snapshots.forEach((snapshot) => {
    if (!Number.isFinite(snapshot.currentValue) || snapshot.currentValue <= 0) return
    const rows = grouped.get(snapshot.assetId) ?? []
    rows.push(snapshot)
    grouped.set(snapshot.assetId, rows)
  })

  const examples: EdgeTrainingExample[] = []
  grouped.forEach((rows) => {
    rows.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    let lastAnchorAt = Number.NEGATIVE_INFINITY
    rows.forEach((anchor, index) => {
      const anchorMs = Date.parse(anchor.capturedAt)
      if (anchorMs - lastAnchorAt < anchorSpacingDays * DAY_MS) return
      let outcome: MarketSnapshotRecord | null = null
      let closest = Number.POSITIVE_INFINITY
      for (let candidateIndex = index + 1; candidateIndex < rows.length; candidateIndex += 1) {
        const candidate = rows[candidateIndex]
        const elapsed = daysBetween(anchor.capturedAt, candidate.capturedAt)
        if (elapsed < horizonDays - toleranceDays) continue
        if (elapsed > horizonDays + toleranceDays) break
        const distance = Math.abs(elapsed - horizonDays)
        if (distance < closest) {
          outcome = candidate
          closest = distance
        }
      }
      if (!outcome) return
      const actualReturn = clamp((outcome.currentValue - anchor.currentValue) / anchor.currentValue, -0.8, 1.5)
      const ruleReturn = clamp(
        anchor.projection30 > 0 ? (anchor.projection30 - anchor.currentValue) / anchor.currentValue : 0,
        -0.8,
        1.5,
      )
      examples.push({
        assetId: anchor.assetId,
        assetName: anchor.assetName,
        position: anchor.position,
        kind: anchor.kind,
        eventType: anchor.eventType,
        newsDirection: anchor.newsDirection,
        capturedAt: anchor.capturedAt,
        outcomeAt: outcome.capturedAt,
        currentValue: anchor.currentValue,
        outcomeValue: outcome.currentValue,
        actualReturn,
        ruleReturn,
        features: anchor.features,
      })
      lastAnchorAt = anchorMs
    })
  })
  return examples.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.assetId.localeCompare(b.assetId))
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function standardDeviation(values: number[]): number {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function calibrationLabel(key: string): string {
  if (key === 'all') return 'All tracked opportunities'
  if (key.startsWith('position:')) return `${key.slice(9)} market response`
  if (key.startsWith('event:')) return `${key.slice(6).replaceAll('_', ' ')} events`
  if (key.startsWith('news:')) return `${key.slice(5)} news signals`
  return key
}

export function calibrateEdgeResponses(examples: EdgeTrainingExample[]): EdgeCalibrationGroup[] {
  const groups = new Map<string, EdgeTrainingExample[]>([['all', examples]])
  examples.forEach((example) => {
    const keys = [`position:${example.position}`]
    if (example.eventType && example.eventType !== 'none' && example.eventType !== 'other') keys.push(`event:${example.eventType}`)
    if (example.newsDirection !== 'none' && example.newsDirection !== 'watch') keys.push(`news:${example.newsDirection}`)
    keys.forEach((key) => groups.set(key, [...(groups.get(key) ?? []), example]))
  })

  return [...groups.entries()]
    .filter(([key, rows]) => key === 'all' || rows.length >= 3)
    .map(([key, rows]) => {
      const actualReturn = mean(rows.map((row) => row.actualReturn))
      const ruleReturn = mean(rows.map((row) => row.ruleReturn))
      const residualReturn = actualReturn - ruleReturn
      const shrinkage = rows.length / (rows.length + 20)
      const volatility = standardDeviation(rows.map((row) => row.actualReturn))
      return {
        key,
        label: calibrationLabel(key),
        sampleSize: rows.length,
        actualReturn,
        ruleReturn,
        residualReturn,
        shrunkenReturn: ruleReturn + residualReturn * shrinkage,
        confidence: Math.round(clamp(shrinkage * (1 - Math.min(0.7, volatility)) * 100, 0, 95)),
      }
    })
    .sort((a, b) => (a.key === 'all' ? -1 : b.key === 'all' ? 1 : b.sampleSize - a.sampleSize || a.key.localeCompare(b.key)))
}

function rank(values: number[]): number[] {
  const ranked = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index)
  const result = Array(values.length).fill(0) as number[]
  for (let index = 0; index < ranked.length;) {
    let end = index + 1
    while (end < ranked.length && ranked[end].value === ranked[index].value) end += 1
    const averageRank = (index + end - 1) / 2
    for (let cursor = index; cursor < end; cursor += 1) result[ranked[cursor].index] = averageRank
    index = end
  }
  return result
}

function correlation(actual: number[], predicted: number[]): number {
  if (actual.length < 2) return 0
  const a = rank(actual)
  const b = rank(predicted)
  const meanA = mean(a)
  const meanB = mean(b)
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0)
  const denominator = Math.sqrt(
    a.reduce((sum, value) => sum + (value - meanA) ** 2, 0)
    * b.reduce((sum, value) => sum + (value - meanB) ** 2, 0),
  )
  return denominator ? numerator / denominator : 0
}

function mae(actual: number[], predicted: number[]): number {
  return mean(actual.map((value, index) => Math.abs(value - predicted[index])))
}

function predictArtifact(artifact: EdgeShadowArtifact, values: number[]): number {
  const standardized = values.map((value, index) => (value - artifact.featureMeans[index]) / artifact.featureScales[index])
  return clamp(artifact.bias + standardized.reduce((sum, value, index) => sum + value * artifact.weights[index], 0), -0.8, 1.5)
}

function fitRidge(examples: EdgeTrainingExample[]): EdgeShadowArtifact {
  const matrix = examples.map((example) => valuesFor({ currentValue: example.currentValue, features: example.features, kind: example.kind, position: example.position }))
  const targets = examples.map((example) => example.actualReturn)
  const featureMeans = FEATURE_NAMES.map((_, index) => mean(matrix.map((row) => row[index])))
  const featureScales = FEATURE_NAMES.map((_, index) => Math.max(0.05, standardDeviation(matrix.map((row) => row[index]))))
  const normalized = matrix.map((row) => row.map((value, index) => (value - featureMeans[index]) / featureScales[index]))
  const weights = Array(FEATURE_NAMES.length).fill(0) as number[]
  let bias = mean(targets)
  const learningRate = 0.035
  const ridge = 0.08
  for (let iteration = 0; iteration < 900; iteration += 1) {
    const weightGradients = Array(FEATURE_NAMES.length).fill(0) as number[]
    let biasGradient = 0
    normalized.forEach((row, rowIndex) => {
      const prediction = bias + row.reduce((sum, value, index) => sum + value * weights[index], 0)
      const error = prediction - targets[rowIndex]
      biasGradient += error
      row.forEach((value, index) => { weightGradients[index] += error * value })
    })
    bias -= learningRate * (biasGradient / normalized.length)
    weights.forEach((weight, index) => {
      weights[index] -= learningRate * (weightGradients[index] / normalized.length + ridge * weight)
    })
  }
  return {
    version: MODEL_VERSION,
    featureNames: [...FEATURE_NAMES],
    featureMeans,
    featureScales,
    weights,
    bias,
  }
}

function emptyMetrics(): EdgeShadowModelHealth['metrics'] {
  return { modelMae: null, baselineMae: null, maeImprovement: null, rankCorrelation: null, baselineRankCorrelation: null }
}

export function trainShadowModel(examples: EdgeTrainingExample[], now = new Date()): {
  health: EdgeShadowModelHealth
  artifact: EdgeShadowArtifact | null
} {
  const ordered = [...examples].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.assetId.localeCompare(b.assetId))
  const captureDates = [...new Set(ordered.map((row) => row.capturedAt.slice(0, 10)))].sort()
  const validationDateCount = captureDates.length >= 2 ? Math.max(1, Math.ceil(captureDates.length * 0.2)) : 0
  const validationStart = validationDateCount ? captureDates[captureDates.length - validationDateCount] : null
  const train = validationStart ? ordered.filter((row) => row.capturedAt.slice(0, 10) < validationStart) : ordered
  const validation = validationStart ? ordered.filter((row) => row.capturedAt.slice(0, 10) >= validationStart) : []
  const trainingRows = train.length
  const validationRows = validation.length
  const uniqueAssets = new Set(ordered.map((row) => row.assetId)).size
  const dateSpanDays = ordered.length > 1 ? Math.max(0, Math.round(daysBetween(ordered[0].capturedAt, ordered.at(-1)!.capturedAt))) : 0
  let artifact: EdgeShadowArtifact | null = null
  let metrics = emptyMetrics()
  if (trainingRows >= 20 && validationRows >= 10) {
    artifact = fitRidge(train)
    const actual = validation.map((row) => row.actualReturn)
    const model = validation.map((row) => predictArtifact(artifact!, valuesFor({ currentValue: row.currentValue, features: row.features, kind: row.kind, position: row.position })))
    const baseline = validation.map((row) => row.ruleReturn)
    const modelMae = mae(actual, model)
    const baselineMae = mae(actual, baseline)
    metrics = {
      modelMae,
      baselineMae,
      maeImprovement: baselineMae ? (baselineMae - modelMae) / baselineMae : 0,
      rankCorrelation: correlation(actual, model),
      baselineRankCorrelation: correlation(actual, baseline),
    }
  }

  const gates = [
    { id: 'trainingRows', label: 'Independent training examples', passed: trainingRows >= MIN_TRAIN_ROWS, actual: trainingRows, requirement: `>= ${MIN_TRAIN_ROWS}` },
    { id: 'validationRows', label: 'Later validation examples', passed: validationRows >= MIN_VALIDATION_ROWS, actual: validationRows, requirement: `>= ${MIN_VALIDATION_ROWS}` },
    { id: 'uniqueAssets', label: 'Unique assets represented', passed: uniqueAssets >= MIN_UNIQUE_ASSETS, actual: uniqueAssets, requirement: `>= ${MIN_UNIQUE_ASSETS}` },
    { id: 'dateSpan', label: 'Market regimes observed', passed: dateSpanDays >= MIN_SPAN_DAYS, actual: dateSpanDays, requirement: `>= ${MIN_SPAN_DAYS} days` },
    { id: 'maeLift', label: 'Held-out MAE lift', passed: (metrics.maeImprovement ?? Number.NEGATIVE_INFINITY) >= MIN_MAE_LIFT, actual: metrics.maeImprovement ?? 0, requirement: `>= ${Math.round(MIN_MAE_LIFT * 100)}% versus no-change baseline` },
    {
      id: 'rankGuardrail',
      label: 'Held-out ranking guardrail',
      passed: metrics.rankCorrelation !== null && metrics.baselineRankCorrelation !== null
        && metrics.rankCorrelation - metrics.baselineRankCorrelation >= MIN_RANK_DELTA,
      actual: metrics.rankCorrelation !== null && metrics.baselineRankCorrelation !== null
        ? metrics.rankCorrelation - metrics.baselineRankCorrelation
        : 0,
      requirement: `>= ${MIN_RANK_DELTA.toFixed(2)} versus no-change baseline`,
    },
  ]
  const passed = gates.every((gate) => gate.passed)
  const status: EdgeShadowModelHealth['status'] = !artifact ? 'collecting' : passed ? 'passed-shadow' : 'shadow'
  return {
    artifact,
    health: {
      version: MODEL_VERSION,
      status,
      productionEnabled: false,
      trainedAt: artifact ? now.toISOString() : null,
      trainingRows,
      validationRows,
      uniqueAssets,
      dateSpanDays,
      metrics,
      gates,
    },
  }
}

export function buildEdgeLearningReport(snapshots: MarketSnapshotRecord[], now = new Date()): EdgeLearningReport {
  const examples = labelMarketSnapshots(snapshots)
  const calibration = calibrateEdgeResponses(examples)
  const { health, artifact } = trainShadowModel(examples, now)
  return { health, calibration, artifact, examples }
}

export function shadowPredictions(
  artifact: EdgeShadowArtifact | null,
  health: EdgeShadowModelHealth,
  snapshots: MarketSnapshotRecord[],
): EdgeShadowPrediction[] {
  if (!artifact) return []
  const latest = new Map<string, MarketSnapshotRecord>()
  snapshots.forEach((snapshot) => {
    const current = latest.get(snapshot.assetId)
    if (!current || Date.parse(snapshot.capturedAt) > Date.parse(current.capturedAt)) latest.set(snapshot.assetId, snapshot)
  })
  const evidenceConfidence = clamp((health.trainingRows + health.validationRows) / 500, 0.1, 1)
  return [...latest.values()].map((snapshot) => {
    const expectedReturn30 = predictArtifact(artifact, valuesFor(snapshot))
    return {
      assetId: snapshot.assetId,
      expectedReturn30,
      expectedValue30: Math.round(snapshot.currentValue * (1 + expectedReturn30)),
      confidence: Math.round(clamp(25 + evidenceConfidence * 45 + snapshot.confidence * 0.2, 20, 82)),
      mode: 'shadow' as const,
    }
  }).sort((a, b) => b.expectedReturn30 - a.expectedReturn30 || a.assetId.localeCompare(b.assetId))
}

export function emptyShadowHealth(): EdgeShadowModelHealth {
  return trainShadowModel([]).health
}
