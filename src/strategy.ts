import { assetStability, evaluateTrade, packageStability } from './rankings'
import type { Asset, Team, TeamStrategyProfile } from './types'

/** Pure, bounded trade-target and offer generator. It deliberately uses only league data
 * already loaded by the client; historical manager preferences are optional inputs. */
export type StrategyDirection = 'buy' | 'sell'
export type OfferStage = 'opening' | 'target' | 'counter' | 'walk-away'

export type ManagerPreferences = {
  /** 0..1 rates, preferably shrunk toward .5 for small historical samples. */
  pickAffinity?: number
  playerAffinity?: number
  consolidationIndex?: number
  depthIndex?: number
  positionAffinity?: Partial<Record<Asset['position'], number>>
  sampleWeight?: number
}

export type TargetReason = { label: string; score: number }

export type TargetCandidate = {
  asset: Asset
  ownerRosterId: number
  score: number
  needScore: number
  timelineScore: number
  lineupScore: number
  availabilityScore: number
  surplusScore: number
  resaleScore: number
  profitScore: number
  decayRisk: number
  projectedExitValue: number
  uncertaintyPenalty: number
  reasons: TargetReason[]
}

export type GeneratedPackage = {
  stage: OfferStage
  send: Asset[]
  receive: Asset[]
  marketDelta: number
  lineupDeltaMe: number
  lineupDeltaThem: number
  acceptanceScore: number
  myScore: number
  exitValueDelta: number
  profitScore: number
  decayRisk: number
  uncertainty: number
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

const SKILL = new Set<Asset['position']>(['QB', 'RB', 'WR', 'TE'])
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const stableId = (assets: Asset[]) => assets.map((asset) => asset.id).sort().join('|')

export type ResolvedTeamStrategy = {
  mode: 'contender' | 'retooling' | 'rebuilding'
  horizonYears: 1 | 2 | 3 | 4
  flipPriority: number
}

export type AssetStrategyMetrics = {
  retentionScore: number
  liquidityScore: number
  decayRisk: number
  profitScore: number
  projectedExitValue: number
}

function requiredSlots(positions: string[], position: Asset['position']): number {
  const direct = positions.filter((slot) => slot === position).length
  if (position === 'QB') return direct + positions.filter((slot) => slot === 'SUPER_FLEX').length
  if (position === 'RB' || position === 'WR' || position === 'TE') {
    return direct + positions.filter((slot) => slot === 'FLEX').length
  }
  return direct
}

export function resolveTeamStrategy(team: Team, input?: TeamStrategyProfile): ResolvedTeamStrategy {
  const inferred = team.metrics.contender - team.metrics.future >= 8
    ? 'contender'
    : team.metrics.future - team.metrics.contender >= 8
      ? 'rebuilding'
      : 'retooling'
  const mode = input?.mode && input.mode !== 'auto' ? input.mode : inferred
  return {
    mode,
    horizonYears: input?.horizonYears ?? (mode === 'contender' ? 1 : mode === 'retooling' ? 2 : 3),
    flipPriority: clamp((input?.flipPriority ?? (mode === 'rebuilding' ? 0.9 : mode === 'retooling' ? 0.6 : 0.25)) * 100) / 100,
  }
}

export function assetStrategyMetrics(asset: Asset, strategy: ResolvedTeamStrategy): AssetStrategyMetrics {
  if (asset.kind === 'pick') {
    const appreciation = strategy.mode === 'rebuilding' ? 1.08 : 1.02
    return {
      retentionScore: 100,
      liquidityScore: 94,
      decayRisk: 0,
      profitScore: 98,
      projectedExitValue: Math.round(asset.value * appreciation),
    }
  }
  const age = asset.age ?? 27
  const declineStart: Partial<Record<Asset['position'], number>> = { QB: 32, RB: 24, WR: 27, TE: 28 }
  const start = declineStart[asset.position] ?? 27
  const ageAtExit = age + strategy.horizonYears
  const yearsPastAtExit = Math.max(0, ageAtExit - start)
  const alreadyPast = Math.max(0, age - start)
  let decayRisk = clamp(yearsPastAtExit * 18 + alreadyPast * 10)
  if (asset.position === 'RB' && age >= 26) decayRisk = clamp(decayRisk + 14)
  if (asset.active === false) decayRisk = clamp(decayRisk + 22)
  if (asset.injuryStatus && !/^healthy$/i.test(asset.injuryStatus)) decayRisk = clamp(decayRisk + 9)
  const confidence = Math.min(1, asset.confidence > 1 ? asset.confidence / 100 : asset.confidence)
  const retentionScore = clamp(100 - decayRisk * 0.72)
  const valueSignal = clamp(Math.log10(Math.max(10, asset.value)) * 22)
  const liquidityScore = clamp(assetStability(asset) * 52 + confidence * 24 + valueSignal * 0.24 - decayRisk * 0.32)
  const profitScore = clamp(retentionScore * 0.45 + liquidityScore * 0.35 + (100 - decayRisk) * 0.2)
  const youthfulUpside = ageAtExit <= start ? Math.min(0.12, Math.max(0, start - ageAtExit) * 0.025) : 0
  const exitMultiplier = clamp(0.48 + retentionScore / 100 * 0.58 + youthfulUpside, 0.35, 1.18)
  return {
    retentionScore,
    liquidityScore,
    decayRisk,
    profitScore,
    projectedExitValue: Math.round(asset.value * exitMultiplier),
  }
}

function ageFit(asset: Asset, strategy: ResolvedTeamStrategy): number {
  if (asset.kind === 'pick') return strategy.mode === 'contender' ? 45 : 92
  const age = asset.age ?? 27
  if (strategy.mode === 'contender') return clamp(70 + assetStability(asset) * 25 - Math.max(0, age - 32) * 4)
  const metrics = assetStrategyMetrics(asset, strategy)
  if (strategy.mode === 'rebuilding') return metrics.retentionScore
  const peak = asset.position === 'RB' ? 23 : asset.position === 'QB' ? 27 : 25
  return clamp(metrics.retentionScore * 0.65 + (100 - Math.abs(age - peak) * 7) * 0.35)
}

function additionImpact(team: Team, asset: Asset, rosterPositions: string[]): number {
  const result = evaluateTrade([], [asset], { teamA: team, teamB: team, rosterPositions })
  return result.lineupImpactA ?? 0
}

function removalImpact(team: Team, asset: Asset, rosterPositions: string[]): number {
  const result = evaluateTrade([asset], [], { teamA: team, teamB: team, rosterPositions })
  return Math.max(0, -(result.lineupImpactA ?? 0))
}

function uncertainty(asset: Asset): number {
  return 100 - clamp((assetStability(asset) * 0.65 + Math.min(1, asset.confidence > 1 ? asset.confidence / 100 : asset.confidence) * 0.35) * 100)
}

/** Ranks assets on one roster that are actionable targets for the other roster. */
export function findTargets(teams: Team[], options: StrategyOptions): TargetCandidate[] {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  const theirs = teams.find((team) => team.rosterId === options.counterpartRosterId)
  if (!mine || !theirs || mine.rosterId === theirs.rosterId) return []
  const strategy = resolveTeamStrategy(mine, options.teamStrategy)
  const candidates = [...theirs.players, ...theirs.picks]
    .filter((asset) => asset.value > 0 && (asset.kind === 'pick' || SKILL.has(asset.position)))
    .map((asset) => {
      const strategyMetrics = assetStrategyMetrics(asset, strategy)
      const rosterAtPosition = mine.players.filter((item) => item.position === asset.position)
      const slots = requiredSlots(options.rosterPositions, asset.position)
      const usable = rosterAtPosition.filter((item) => item.isReserve !== true && item.active !== false).length
      const needScore = asset.kind === 'pick'
        ? (strategy.mode === 'contender' ? 30 : 78)
        : strategy.mode === 'rebuilding'
          ? clamp(20 + Math.max(0, slots - usable) * 8 + additionImpact(mine, asset, options.rosterPositions) * 2)
          : clamp(35 + Math.max(0, slots - usable) * 30 + additionImpact(mine, asset, options.rosterPositions) * 7)
      const timelineScore = ageFit(asset, strategy)
      const lineupScore = clamp(additionImpact(mine, asset, options.rosterPositions) * 10 + (asset.isStarter ? 12 : 0))
      const loss = removalImpact(theirs, asset, options.rosterPositions)
      const availabilityScore = clamp(82 - loss * 11 - (asset.isStarter ? 10 : 0))
      const samePosition = theirs.players.filter((item) => item.position === asset.position && item.id !== asset.id)
      const surplusScore = clamp(samePosition.filter((item) => item.value >= asset.value * 0.58).length * 26)
      const uncertaintyPenalty = uncertainty(asset)
      const score = strategy.mode === 'rebuilding'
        ? clamp(
          0.27 * strategyMetrics.profitScore
          + 0.22 * timelineScore
          + 0.18 * strategyMetrics.liquidityScore
          + 0.16 * availabilityScore
          + 0.08 * surplusScore
          + 0.04 * needScore
          + 0.05 * lineupScore
          - 0.17 * uncertaintyPenalty
          - 0.20 * strategyMetrics.decayRisk,
        )
        : clamp(0.30 * needScore + 0.25 * timelineScore + 0.15 * lineupScore + 0.15 * availabilityScore + 0.10 * surplusScore - 0.15 * uncertaintyPenalty)
      const reasons: TargetReason[] = [
        { label: strategy.mode === 'rebuilding' ? 'Profit potential' : 'Roster need', score: Math.round(strategy.mode === 'rebuilding' ? strategyMetrics.profitScore : needScore) },
        { label: 'Timeline fit', score: Math.round(timelineScore) },
        { label: 'Resale liquidity', score: Math.round(strategyMetrics.liquidityScore) },
        { label: 'Partner availability', score: Math.round(availabilityScore) },
      ].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 2)
      return {
        asset,
        ownerRosterId: theirs.rosterId,
        score: Math.round(score),
        needScore: Math.round(needScore),
        timelineScore: Math.round(timelineScore),
        lineupScore: Math.round(lineupScore),
        availabilityScore: Math.round(availabilityScore),
        surplusScore: Math.round(surplusScore),
        resaleScore: Math.round(strategyMetrics.liquidityScore),
        profitScore: Math.round(strategyMetrics.profitScore),
        decayRisk: Math.round(strategyMetrics.decayRisk),
        projectedExitValue: strategyMetrics.projectedExitValue,
        uncertaintyPenalty: Math.round(uncertaintyPenalty),
        reasons,
      }
    })
    .filter((candidate) => strategy.mode !== 'rebuilding' || candidate.decayRisk < 70 || candidate.profitScore >= 68)
  return candidates.sort((a, b) => b.score - a.score || b.asset.value - a.asset.value || a.asset.id.localeCompare(b.asset.id)).slice(0, options.maxTargets ?? 8)
}

function combinations(assets: Asset[], limit = 600): Asset[][] {
  const result: Asset[][] = []
  for (let size = 1; size <= 3; size += 1) {
    const visit = (start: number, current: Asset[]) => {
      if (result.length >= limit) return
      if (current.length === size) { result.push(current); return }
      for (let index = start; index < assets.length; index += 1) visit(index + 1, [...current, assets[index]])
    }
    visit(0, [])
  }
  return result
}

function offerability(team: Team, asset: Asset, rosterPositions: string[], strategy: ResolvedTeamStrategy): number {
  const removal = removalImpact(team, asset, rosterPositions)
  const starterTax = asset.isStarter ? 25 : 0
  const metrics = assetStrategyMetrics(asset, strategy)
  const futureCoreTax = strategy.mode === 'rebuilding'
    ? metrics.retentionScore * 0.28 + metrics.liquidityScore * 0.22 + (asset.kind === 'pick' ? 24 : 0)
    : 0
  return clamp(100 - removal * 18 - starterTax - uncertainty(asset) * 0.15 - futureCoreTax + metrics.decayRisk * 0.3)
}

function managerMatch(sent: Asset[], preferences: ManagerPreferences | undefined): number {
  if (!preferences) return 50
  const weight = clamp(preferences.sampleWeight ?? 0.35, 0, 1)
  const pick = preferences.pickAffinity ?? 0.5
  const player = preferences.playerAffinity ?? 0.5
  const position = preferences.positionAffinity ?? {}
  const raw = sent.reduce((sum, asset) => sum + (asset.kind === 'pick' ? pick : (player + (position[asset.position] ?? 0.5)) / 2), 0) / Math.max(1, sent.length)
  return clamp((0.5 + (raw - 0.5) * weight) * 100)
}

function packageFor(
  target: TargetCandidate,
  send: Asset[],
  mine: Team,
  theirs: Team,
  options: StrategyOptions,
  strategy: ResolvedTeamStrategy,
): GeneratedPackage | null {
  const result = evaluateTrade(send, [target.asset], { teamA: mine, teamB: theirs, rosterPositions: options.rosterPositions })
  const costRatio = result.valueA / Math.max(1, result.valueB)
  const receiveExit = target.projectedExitValue
  const sendExit = send.reduce((sum, asset) => sum + assetStrategyMetrics(asset, strategy).projectedExitValue, 0)
  const exitValueDelta = receiveExit - sendExit
  const maxCurrentCost = strategy.mode === 'rebuilding' ? 1.01 : 1.08
  if (costRatio > maxCurrentCost) return null
  if (strategy.mode === 'rebuilding' && (exitValueDelta < 0 || target.decayRisk >= 70)) return null
  const match = managerMatch(send, options.manager)
  const theirNeed = clamp((result.lineupImpactB ?? 0) * 12 + target.availabilityScore * 0.25)
  const acceptanceScore = clamp(result.ratingB * 0.55 + match * 0.25 + theirNeed * 0.20)
  const myScore = strategy.mode === 'rebuilding'
    ? clamp(
      result.ratingA * 0.26
      + target.profitScore * 0.28
      + target.resaleScore * 0.18
      + target.timelineScore * 0.16
      + clamp(exitValueDelta / Math.max(1, result.valueB) * 100 + 50) * 0.12
      - target.decayRisk * 0.18
      - target.uncertaintyPenalty * 0.1,
    )
    : clamp(result.ratingA * 0.60 + clamp((result.lineupImpactA ?? 0) * 10 + target.timelineScore * 0.18) * 0.25 + packageStability([target.asset]) * 100 * 0.15 - target.uncertaintyPenalty * 0.10)
  const dealUncertainty = Math.round((uncertainty(target.asset) + send.reduce((sum, asset) => sum + uncertainty(asset), 0) / send.length) / 2)
  return {
    stage: 'opening',
    send,
    receive: [target.asset],
    marketDelta: result.marketNetA,
    lineupDeltaMe: result.lineupImpactA ?? 0,
    lineupDeltaThem: result.lineupImpactB ?? 0,
    acceptanceScore: Math.round(acceptanceScore),
    myScore: Math.round(myScore),
    exitValueDelta: Math.round(exitValueDelta),
    profitScore: target.profitScore,
    decayRisk: target.decayRisk,
    uncertainty: dealUncertainty,
    explanation: strategy.mode === 'rebuilding'
      ? `${target.asset.name} clears the future-value guardrail with ${target.resaleScore}/100 resale liquidity.`
      : `${target.asset.name} addresses ${target.reasons.map((reason) => reason.label.toLowerCase()).join(' and ')}.`,
  }
}

function chooseStage(candidates: GeneratedPackage[], stage: OfferStage, acceptance: number, mine: number): GeneratedPackage | null {
  const eligible = candidates.filter((item) => item.acceptanceScore >= acceptance && item.myScore >= mine)
  const sorted = eligible.sort((a, b) =>
    Math.abs(a.acceptanceScore - acceptance) - Math.abs(b.acceptanceScore - acceptance)
    || b.myScore - a.myScore || a.send.length - b.send.length || a.uncertainty - b.uncertainty || stableId(a.send).localeCompare(stableId(b.send)),
  )
  return sorted[0] ? { ...sorted[0], stage } : null
}

/** Generates up to four staged, bounded offers for the top actionable target. */
export function buildTradePlan(teams: Team[], options: StrategyOptions): TradePlan {
  const mine = teams.find((team) => team.rosterId === options.myRosterId)
  const theirs = teams.find((team) => team.rosterId === options.counterpartRosterId)
  const direction = options.direction ?? 'buy'
  const strategy = mine ? resolveTeamStrategy(mine, options.teamStrategy) : null
  const rankedTargets = findTargets(teams, options)
  const targets = options.targetAssetId
    ? rankedTargets.filter((target) => target.asset.id === options.targetAssetId)
    : rankedTargets
  if (!mine || !theirs || !strategy || direction !== 'buy') return { myRosterId: options.myRosterId, counterpartRosterId: options.counterpartRosterId, direction, targets, packages: [], evidenceNote: 'Select two different current rosters. Sell-side automation is intentionally deferred.' }
  const outgoing = [...mine.players, ...mine.picks]
    .filter((asset) => asset.value > 0)
    .sort((a, b) => offerability(mine, b, options.rosterPositions, strategy) - offerability(mine, a, options.rosterPositions, strategy) || a.id.localeCompare(b.id))
    .slice(0, 12)
  let packages: GeneratedPackage[] = []
  for (const target of targets) {
    const possible = combinations(outgoing).map((send) => packageFor(target, send, mine, theirs, options, strategy)).filter((item): item is GeneratedPackage => item !== null)
    const stages: Array<[OfferStage, number, number]> = [['opening', 42, 50], ['target', 48, 46], ['counter', 54, 42], ['walk-away', 60, 0]]
    const used = new Set<string>()
    const targetPackages: GeneratedPackage[] = []
    stages.forEach(([stage, acceptance, myScore]) => {
      const pick = chooseStage(possible.filter((item) => !used.has(stableId(item.send))), stage, acceptance, myScore)
      if (pick) { used.add(stableId(pick.send)); targetPackages.push(pick) }
    })
    if (targetPackages.length) {
      packages = targetPackages
      break
    }
  }
  return {
    myRosterId: mine.rosterId,
    counterpartRosterId: theirs.rosterId,
    direction,
    targets,
    packages,
    evidenceNote: strategy.mode === 'rebuilding'
      ? `Rebuild mode protects a ${strategy.horizonYears}-year window: packages cannot sacrifice projected exit value, and high-decay assets are excluded. Acceptance remains a fit score, not a prediction.`
      : 'Packages use current Sleeper rosters and completed-trade preferences only. Acceptance is a fit score, not a prediction of a manager response.',
  }
}
