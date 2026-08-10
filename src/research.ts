export type ResearchPhaseStatus = 'ready' | 'collecting' | 'shadow' | 'blocked'

export type ResearchGate = {
  id: string
  label: string
  passed: boolean
  actual: number
  requirement: string
  format: 'count' | 'percent' | 'decimal'
}

export type ResearchPhase = {
  version: '5.1' | '5.2' | '5.3' | '5.4' | '5.5' | '5.6'
  title: string
  status: ResearchPhaseStatus
  productionEnabled: boolean
  summary: string
  gates: ResearchGate[]
}

export type ResearchPipelineBundle = {
  generatedAt: string
  leagueId: string
  lastLeagueSyncAt: string | null
  phases: ResearchPhase[]
  leagueTape: {
    seasons: number
    expectedRosterWeeks: number
    rosterWeeks: number
    coverageRate: number
  }
  objectiveTape: {
    sourceSeasons: number
    historicalRows: number
    trackedPlayers: number
    observations: number
    lastObservedAt: string | null
  }
  trainingTape: TrainingJoinAudit
  managerTape: {
    managers: number
    completedTrades: number
    reliableManagers: number
    identityCoverage: number
  }
  newsExperiment: {
    storedEvents: number
    matchedExamples: number
    sourceCount: number
    heldOutLift: number | null
  }
  notes: string[]
}

export type MatchupObservation = {
  rosterId: number
  matchupId: number | null
  players: string[]
  starters: string[]
  points: number
}

export type LeagueWeekState = {
  leagueId: string
  season: string
  week: number
  rosterId: number
  ownerUserId: string | null
  players: string[]
  starters: string[]
  points: number
  pointsAgainst: number
  wins: number
  losses: number
  ties: number
}

export type HistoricalMarketPoint = {
  assetId: string
  assetName: string
  position: string
  observedAt: string
  value: number
}

export type ObjectivePlayerObservation = {
  assetId: string
  observedAt: string
  team: string | null
  active: boolean | null
  status: string | null
  injuryStatus: string | null
  depthChartOrder: number | null
}

export type HistoricalNewsObservation = {
  playerId: string
  publishedAt: string
  eventType: string
  direction: 'up' | 'down' | 'watch'
  impactWeight: number
}

export type HistoricalTrainingExample = {
  assetId: string
  assetName: string
  position: string
  asOf: string
  outcomeAt: string
  currentValue: number
  outcomeValue: number
  return30: number
  momentum30: number
  momentum90: number
  volatility90: number
  objectiveObservedAt: string | null
  active: boolean | null
  injured: boolean | null
  depthChartOrder: number | null
  newsCount7: number
  newsImpact7: number
  latestNewsAt: string | null
}

export type TrainingJoinAudit = {
  examples: number
  uniqueAssets: number
  dateSpanDays: number
  objectiveCoverage: number
  newsCoverage: number
  leakageViolations: number
}

export type HistoricalShadowEvaluation = {
  trainingRows: number
  validationRows: number
  baselineMae: number | null
  modelMae: number | null
  maeLift: number | null
}

const DAY_MS = 86_400_000

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function standardDeviation(values: number[]): number {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function closestPriorValue(rows: HistoricalMarketPoint[], at: number, days: number): number | null {
  const target = at - days * DAY_MS
  let best: HistoricalMarketPoint | null = null
  let distance = Number.POSITIVE_INFINITY
  rows.forEach((row) => {
    const timestamp = Date.parse(row.observedAt)
    if (timestamp > at || timestamp >= at - 7 * DAY_MS) return
    const candidateDistance = Math.abs(timestamp - target)
    if (candidateDistance <= 14 * DAY_MS && candidateDistance < distance) {
      best = row
      distance = candidateDistance
    }
  })
  return best ? (best as HistoricalMarketPoint).value : null
}

function outcomeNear(rows: HistoricalMarketPoint[], at: number, days: number): HistoricalMarketPoint | null {
  const target = at + days * DAY_MS
  let best: HistoricalMarketPoint | null = null
  let distance = Number.POSITIVE_INFINITY
  rows.forEach((row) => {
    const timestamp = Date.parse(row.observedAt)
    if (timestamp <= at) return
    const candidateDistance = Math.abs(timestamp - target)
    if (candidateDistance <= 7 * DAY_MS && candidateDistance < distance) {
      best = row
      distance = candidateDistance
    }
  })
  return best
}

function latestObjective(rows: ObjectivePlayerObservation[], at: number): ObjectivePlayerObservation | null {
  return rows.reduce<ObjectivePlayerObservation | null>((latest, row) => {
    const timestamp = Date.parse(row.observedAt)
    if (timestamp > at || (latest && Date.parse(latest.observedAt) >= timestamp)) return latest
    return row
  }, null)
}

/**
 * Produces immutable, source-relative 30-day labels. Every feature lookup is
 * constrained to timestamps at or before the anchor; the outcome is the only
 * field allowed to come from the future.
 */
export function buildHistoricalTrainingExamples(
  market: HistoricalMarketPoint[],
  objective: ObjectivePlayerObservation[],
  news: HistoricalNewsObservation[],
  anchorSpacingDays = 21,
): HistoricalTrainingExample[] {
  const marketByAsset = new Map<string, HistoricalMarketPoint[]>()
  market.forEach((point) => {
    if (!Number.isFinite(point.value) || point.value <= 0 || Number.isNaN(Date.parse(point.observedAt))) return
    marketByAsset.set(point.assetId, [...(marketByAsset.get(point.assetId) ?? []), point])
  })
  const objectiveByAsset = new Map<string, ObjectivePlayerObservation[]>()
  objective.forEach((point) => objectiveByAsset.set(point.assetId, [...(objectiveByAsset.get(point.assetId) ?? []), point]))
  const newsByAsset = new Map<string, HistoricalNewsObservation[]>()
  news.forEach((point) => newsByAsset.set(point.playerId, [...(newsByAsset.get(point.playerId) ?? []), point]))

  const examples: HistoricalTrainingExample[] = []
  marketByAsset.forEach((unsorted, assetId) => {
    const rows = [...unsorted].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
    let lastAnchor = Number.NEGATIVE_INFINITY
    rows.forEach((anchor) => {
      const anchorAt = Date.parse(anchor.observedAt)
      if (anchorAt - lastAnchor < anchorSpacingDays * DAY_MS) return
      const outcome = outcomeNear(rows, anchorAt, 30)
      if (!outcome) return
      const prior30 = closestPriorValue(rows, anchorAt, 30)
      const prior90 = closestPriorValue(rows, anchorAt, 90)
      const window90 = rows.filter((row) => {
        const timestamp = Date.parse(row.observedAt)
        return timestamp <= anchorAt && timestamp >= anchorAt - 90 * DAY_MS
      }).map((row) => row.value)
      const objectivePoint = latestObjective(objectiveByAsset.get(assetId) ?? [], anchorAt)
      const recentNews = (newsByAsset.get(assetId) ?? []).filter((item) => {
        const timestamp = Date.parse(item.publishedAt)
        return timestamp <= anchorAt && timestamp >= anchorAt - 7 * DAY_MS
      })
      const latestNews = recentNews.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null
      const signedImpact = recentNews.reduce((sum, item) => {
        const direction = item.direction === 'up' ? 1 : item.direction === 'down' ? -1 : 0
        return sum + direction * item.impactWeight
      }, 0)
      examples.push({
        assetId,
        assetName: anchor.assetName,
        position: anchor.position,
        asOf: anchor.observedAt,
        outcomeAt: outcome.observedAt,
        currentValue: anchor.value,
        outcomeValue: outcome.value,
        return30: clamp((outcome.value - anchor.value) / anchor.value, -0.8, 1.5),
        momentum30: prior30 ? clamp((anchor.value - prior30) / prior30, -0.8, 1.5) : 0,
        momentum90: prior90 ? clamp((anchor.value - prior90) / prior90, -0.8, 1.5) : 0,
        volatility90: anchor.value ? standardDeviation(window90) / anchor.value : 0,
        objectiveObservedAt: objectivePoint?.observedAt ?? null,
        active: objectivePoint?.active ?? null,
        injured: objectivePoint ? Boolean(objectivePoint.injuryStatus && objectivePoint.injuryStatus !== 'Healthy') : null,
        depthChartOrder: objectivePoint?.depthChartOrder ?? null,
        newsCount7: recentNews.length,
        newsImpact7: signedImpact,
        latestNewsAt: latestNews?.publishedAt ?? null,
      })
      lastAnchor = anchorAt
    })
  })
  return examples.sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf) || a.assetId.localeCompare(b.assetId))
}

export function auditHistoricalTrainingExamples(examples: HistoricalTrainingExample[]): TrainingJoinAudit {
  let leakageViolations = 0
  examples.forEach((row) => {
    const anchor = Date.parse(row.asOf)
    if (Date.parse(row.outcomeAt) <= anchor) leakageViolations += 1
    if (row.objectiveObservedAt && Date.parse(row.objectiveObservedAt) > anchor) leakageViolations += 1
    if (row.latestNewsAt && Date.parse(row.latestNewsAt) > anchor) leakageViolations += 1
  })
  const dates = examples.map((row) => Date.parse(row.asOf)).filter(Number.isFinite)
  return {
    examples: examples.length,
    uniqueAssets: new Set(examples.map((row) => row.assetId)).size,
    dateSpanDays: dates.length > 1 ? Math.round((Math.max(...dates) - Math.min(...dates)) / DAY_MS) : 0,
    objectiveCoverage: examples.length ? examples.filter((row) => row.objectiveObservedAt).length / examples.length : 0,
    newsCoverage: examples.length ? examples.filter((row) => row.newsCount7 > 0).length / examples.length : 0,
    leakageViolations,
  }
}

function timeSplit(examples: HistoricalTrainingExample[]): {
  train: HistoricalTrainingExample[]
  validation: HistoricalTrainingExample[]
} {
  const dates = [...new Set(examples.map((row) => row.asOf.slice(0, 10)))].sort()
  if (dates.length < 2) return { train: examples, validation: [] }
  const validationDates = Math.max(1, Math.ceil(dates.length * 0.2))
  const validationStart = dates[dates.length - validationDates]
  return {
    train: examples.filter((row) => row.asOf.slice(0, 10) < validationStart),
    validation: examples.filter((row) => row.asOf.slice(0, 10) >= validationStart),
  }
}

function fitLinear(
  rows: HistoricalTrainingExample[],
  features: (row: HistoricalTrainingExample) => number[],
): (row: HistoricalTrainingExample) => number {
  const matrix = rows.map(features)
  const targets = rows.map((row) => row.return30)
  const width = matrix[0]?.length ?? 0
  const means = Array.from({ length: width }, (_, index) => mean(matrix.map((row) => row[index])))
  const scales = Array.from({ length: width }, (_, index) => Math.max(0.05, standardDeviation(matrix.map((row) => row[index]))))
  const normalized = matrix.map((row) => row.map((value, index) => (value - means[index]) / scales[index]))
  const weights = Array(width).fill(0) as number[]
  let bias = mean(targets)
  for (let iteration = 0; iteration < 800; iteration += 1) {
    const gradients = Array(width).fill(0) as number[]
    let biasGradient = 0
    normalized.forEach((row, rowIndex) => {
      const error = bias + row.reduce((sum, value, index) => sum + value * weights[index], 0) - targets[rowIndex]
      biasGradient += error
      row.forEach((value, index) => { gradients[index] += error * value })
    })
    bias -= 0.03 * biasGradient / Math.max(1, rows.length)
    weights.forEach((weight, index) => {
      weights[index] -= 0.03 * (gradients[index] / Math.max(1, rows.length) + weight * 0.1)
    })
  }
  return (row) => {
    const values = features(row).map((value, index) => (value - means[index]) / scales[index])
    return clamp(bias + values.reduce((sum, value, index) => sum + value * weights[index], 0), -0.8, 1.5)
  }
}

function baseHistoricalFeatures(row: HistoricalTrainingExample): number[] {
  return [
    row.momentum30,
    row.momentum90,
    clamp(row.volatility90, 0, 2),
    row.active === null ? 0.5 : row.active ? 1 : 0,
    row.injured === null ? 0 : row.injured ? 1 : 0,
    row.depthChartOrder === null ? 0 : clamp(row.depthChartOrder / 5, 0, 2),
    row.position === 'QB' ? 1 : 0,
    row.position === 'RB' ? 1 : 0,
    row.position === 'WR' ? 1 : 0,
    row.position === 'TE' ? 1 : 0,
  ]
}

function evaluateCandidate(
  examples: HistoricalTrainingExample[],
  candidateFeatures: (row: HistoricalTrainingExample) => number[],
  baselineFeatures: (row: HistoricalTrainingExample) => number[] | null,
): HistoricalShadowEvaluation {
  const { train, validation } = timeSplit(examples)
  if (train.length < 20 || validation.length < 10) {
    return { trainingRows: train.length, validationRows: validation.length, baselineMae: null, modelMae: null, maeLift: null }
  }
  const candidate = fitLinear(train, candidateFeatures)
  const baseline = fitLinear(train, (row) => baselineFeatures(row) ?? [row.momentum30])
  const actual = validation.map((row) => row.return30)
  const candidateMae = mean(validation.map((row, index) => Math.abs(actual[index] - candidate(row))))
  const baselineMae = mean(validation.map((row, index) => Math.abs(actual[index] - baseline(row))))
  return {
    trainingRows: train.length,
    validationRows: validation.length,
    baselineMae,
    modelMae: candidateMae,
    maeLift: baselineMae ? (baselineMae - candidateMae) / baselineMae : 0,
  }
}

/** Evaluates market, objective, and position features against market momentum alone. */
export function evaluateHistoricalReturnShadow(examples: HistoricalTrainingExample[]): HistoricalShadowEvaluation {
  return evaluateCandidate(examples, baseHistoricalFeatures, (row) => [row.momentum30])
}

/** Evaluates whether timestamped news adds lift beyond the objective-event feature set. */
export function evaluateNewsFeatureLift(examples: HistoricalTrainingExample[]): HistoricalShadowEvaluation {
  const matched = examples.filter((row) => row.newsCount7 > 0)
  return evaluateCandidate(
    matched,
    (row) => [...baseHistoricalFeatures(row), clamp(row.newsCount7 / 3, 0, 2), clamp(row.newsImpact7 / 10, -2, 2)],
    baseHistoricalFeatures,
  )
}

export function reconstructLeagueWeekStates(input: {
  leagueId: string
  season: string
  ownerByRoster: Map<number, string | null>
  weeks: Array<{ week: number; matchups: MatchupObservation[] }>
}): LeagueWeekState[] {
  const records = new Map<number, { wins: number; losses: number; ties: number }>()
  const states: LeagueWeekState[] = []
  ;[...input.weeks].sort((a, b) => a.week - b.week).forEach(({ week, matchups }) => {
    const byMatchup = new Map<number, MatchupObservation[]>()
    matchups.forEach((row) => {
      if (row.matchupId === null) return
      byMatchup.set(row.matchupId, [...(byMatchup.get(row.matchupId) ?? []), row])
    })
    matchups.forEach((row) => {
      const record = records.get(row.rosterId) ?? { wins: 0, losses: 0, ties: 0 }
      const opponent = row.matchupId === null
        ? null
        : (byMatchup.get(row.matchupId) ?? []).find((candidate) => candidate.rosterId !== row.rosterId) ?? null
      if (opponent) {
        if (row.points > opponent.points) record.wins += 1
        else if (row.points < opponent.points) record.losses += 1
        else record.ties += 1
      }
      records.set(row.rosterId, record)
      states.push({
        leagueId: input.leagueId,
        season: input.season,
        week,
        rosterId: row.rosterId,
        ownerUserId: input.ownerByRoster.get(row.rosterId) ?? null,
        players: [...row.players].sort(),
        starters: [...row.starters],
        points: row.points,
        pointsAgainst: opponent?.points ?? 0,
        ...record,
      })
    })
  })
  return states
}

function gate(
  id: string, label: string, passed: boolean, actual: number, requirement: string,
  format: ResearchGate['format'] = 'count',
): ResearchGate {
  return { id, label, passed, actual, requirement, format }
}

function phaseStatus(gates: ResearchGate[], ready: ResearchPhaseStatus = 'ready'): ResearchPhaseStatus {
  return gates.every((item) => item.passed) ? ready : 'collecting'
}

export function buildResearchPipeline(input: {
  generatedAt: string
  leagueId: string
  lastLeagueSyncAt: string | null
  seasons: number
  expectedRosterWeeks: number
  rosterWeeks: number
  objectiveSourceSeasons: number
  objectiveHistoricalRows: number
  objectiveTrackedPlayers: number
  objectiveObservations: number
  objectiveLastObservedAt: string | null
  training: TrainingJoinAudit
  shadow: { trainingRows: number; validationRows: number; maeLift: number | null; productionEnabled: boolean }
  managers: number
  completedTrades: number
  reliableManagers: number
  identityCoverage: number
  storedNewsEvents: number
  matchedNewsExamples: number
  newsSourceCount: number
  newsHeldOutLift: number | null
}): ResearchPipelineBundle {
  const leagueCoverage = input.expectedRosterWeeks ? input.rosterWeeks / input.expectedRosterWeeks : 0
  const v51 = [
    gate('linkedSeasons', 'Linked seasons reconstructed', input.seasons >= 2, input.seasons, '>= 2 seasons'),
    gate('rosterWeekCoverage', 'Historical roster-week coverage', leagueCoverage >= 0.85, leagueCoverage, '>= 85%', 'percent'),
  ]
  const v52 = [
    gate('objectiveSeasons', 'Objective source seasons', input.objectiveSourceSeasons >= 3, input.objectiveSourceSeasons, '>= 3 seasons'),
    gate('objectiveRows', 'Historical player-week rows', input.objectiveHistoricalRows >= 2_000, input.objectiveHistoricalRows, '>= 2,000 rows'),
  ]
  const v53 = [
    gate('trainingExamples', 'Independent market labels', input.training.examples >= 2_000, input.training.examples, '>= 2,000 labels'),
    gate('objectiveJoin', 'Objective feature join coverage', input.training.objectiveCoverage >= 0.8, input.training.objectiveCoverage, '>= 80%', 'percent'),
    gate('leakage', 'Future-feature leakage', input.training.leakageViolations === 0, input.training.leakageViolations, '= 0 violations'),
  ]
  const v54 = [
    gate('shadowTrain', 'Earlier training examples', input.shadow.trainingRows >= 160, input.shadow.trainingRows, '>= 160 rows'),
    gate('shadowValidation', 'Later validation examples', input.shadow.validationRows >= 40, input.shadow.validationRows, '>= 40 rows'),
    gate('shadowLift', 'Held-out MAE lift', (input.shadow.maeLift ?? -1) >= 0.05, input.shadow.maeLift ?? 0, '>= 5%', 'percent'),
  ]
  const v55 = [
    gate('managerTrades', 'Completed trade evidence', input.completedTrades >= 12, input.completedTrades, '>= 12 league trades'),
    gate('managerIdentity', 'Season-correct identity coverage', input.identityCoverage >= 0.9, input.identityCoverage, '>= 90%', 'percent'),
  ]
  const v56 = [
    gate('newsEvents', 'Stored historical news events', input.storedNewsEvents >= 100, input.storedNewsEvents, '>= 100 events'),
    gate('newsLabels', 'News-matched market labels', input.matchedNewsExamples >= 100, input.matchedNewsExamples, '>= 100 labels'),
    gate('newsSources', 'Independent news sources', input.newsSourceCount >= 3, input.newsSourceCount, '>= 3 sources'),
    gate('newsLift', 'Held-out news feature lift', (input.newsHeldOutLift ?? -1) >= 0.03, input.newsHeldOutLift ?? 0, '>= 3%', 'percent'),
  ]
  const phases: ResearchPhase[] = [
    { version: '5.1', title: 'Historical league reconstruction', status: phaseStatus(v51), productionEnabled: v51.every((item) => item.passed), summary: 'Weekly Sleeper rosters, starters, results, and season-correct owner identity.', gates: v51 },
    { version: '5.2', title: 'Objective NFL event tape', status: phaseStatus(v52), productionEnabled: false, summary: 'Usage and availability history from objective football data; advisory until its event lift clears.', gates: v52 },
    { version: '5.3', title: 'Leak-safe feature joins', status: phaseStatus(v53), productionEnabled: false, summary: 'Every feature is frozen at the anchor date; only the 30-day outcome can come from the future.', gates: v53 },
    { version: '5.4', title: 'Historical return shadow model', status: phaseStatus(v54, 'shadow'), productionEnabled: input.shadow.productionEnabled && v54.every((item) => item.passed), summary: 'A later-date challenger to market momentum and the existing rule projection.', gates: v54 },
    { version: '5.5', title: 'Manager revealed preferences', status: phaseStatus(v55), productionEnabled: v55.every((item) => item.passed), summary: `${input.reliableManagers}/${input.managers} managers currently have useful weight; sparse histories shrink toward neutral.`, gates: v55 },
    { version: '5.6', title: 'Historical news experiment', status: phaseStatus(v56, 'shadow'), productionEnabled: false, summary: 'News remains a private shadow feature until it improves later, untouched market labels.', gates: v56 },
  ]
  return {
    generatedAt: input.generatedAt,
    leagueId: input.leagueId,
    lastLeagueSyncAt: input.lastLeagueSyncAt,
    phases,
    leagueTape: { seasons: input.seasons, expectedRosterWeeks: input.expectedRosterWeeks, rosterWeeks: input.rosterWeeks, coverageRate: leagueCoverage },
    objectiveTape: {
      sourceSeasons: input.objectiveSourceSeasons,
      historicalRows: input.objectiveHistoricalRows,
      trackedPlayers: input.objectiveTrackedPlayers,
      observations: input.objectiveObservations,
      lastObservedAt: input.objectiveLastObservedAt,
    },
    trainingTape: input.training,
    managerTape: {
      managers: input.managers,
      completedTrades: input.completedTrades,
      reliableManagers: input.reliableManagers,
      identityCoverage: input.identityCoverage,
    },
    newsExperiment: {
      storedEvents: input.storedNewsEvents,
      matchedExamples: input.matchedNewsExamples,
      sourceCount: input.newsSourceCount,
      heldOutLift: input.newsHeldOutLift,
    },
    notes: [
      'Private intent is never treated as ground truth; completed trades and offer outcomes are revealed-preference evidence only.',
      'No V5 historical or news challenger can alter live rankings until its later-date validation gates pass.',
    ],
  }
}
