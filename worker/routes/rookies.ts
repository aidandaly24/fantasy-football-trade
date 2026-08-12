import type { RookieBoardBundle, RookieBoardPlayer } from '../../src/rookies'
import rookieBoardArtifact from '../generated/rookie-board.json'
import futureRookieStatus from '../generated/future-rookie-status.json'
import type { Env } from '../env'
import { methodNotAllowed, privateJson } from '../http'
import { authenticatedUser } from '../user-store'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isRookiePlayer(value: unknown): value is RookieBoardPlayer {
  if (!isRecord(value) || !isRecord(value.evidence) || !isRecord(value.historicalResidualBand80)) return false
  return typeof value.id === 'string'
    && value.id.length > 0
    && isNullableString(value.sleeperId)
    && typeof value.name === 'string'
    && ['QB', 'RB', 'WR', 'TE'].includes(String(value.position))
    && isNullableString(value.nflTeam)
    && isNullableString(value.college)
    && isFiniteNumber(value.draftBoardRank)
    && isFiniteNumber(value.rookieMarketRank)
    && typeof value.lateCandidate === 'boolean'
    && typeof value.inValidatedSleeperBasket === 'boolean'
    && isFiniteNumber(value.expectedRookieProductionPercentile)
    && isFiniteNumber(value.marketOnlyExpectedProductionPercentile)
    && isFiniteNumber(value.evidenceAdjustment)
    && isFiniteNumber(value.modelDisagreement)
    && isFiniteNumber(value.historicalResidualBand80.lower)
    && isFiniteNumber(value.historicalResidualBand80.upper)
    && typeof value.historicalResidualBand80.meaning === 'string'
    && isNullableFiniteNumber(value.evidence.nflDraftOverall)
    && isFiniteNumber(value.evidence.collegeSeasonsObserved)
    && isNullableFiniteNumber(value.evidence.finalCollegeScrimmageShare)
    && isNullableFiniteNumber(value.evidence.maxCollegeScrimmageShare)
    && isNullableFiniteNumber(value.evidence.finalCollegeTargetShare)
    && isNullableFiniteNumber(value.evidence.forty)
    && typeof value.evidence.collegeDataPresent === 'boolean'
    && typeof value.evidence.combineDataPresent === 'boolean'
}

function isClassResult(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.rookieYear)
    && isFiniteNumber(value.modelBasketMeanPercentile)
    && typeof value.strongestSimpleBaseline === 'string'
    && isFiniteNumber(value.strongestSimpleBaselineMeanPercentile)
    && isFiniteNumber(value.lift)
}

function isPickOpportunity(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.exact112Gate)) return false
  return isFiniteNumber(value.class)
    && value.status === 'advisory'
    && value.advisoryOnly === true
    && typeof value.availabilityMeaning === 'string'
    && Array.isArray(value.availabilityRules)
    && value.availabilityRules.every((item) => typeof item === 'string')
    && value.exactSlotPromotion === false
    && typeof value.exact112Gate.passed === 'boolean'
    && Array.isArray(value.slots)
    && value.slots.length === 24
    && value.slots.every((slot) => isRecord(slot) && isFiniteNumber(slot.slot) && typeof slot.label === 'string' && Array.isArray(slot.candidates))
    && Array.isArray(value.boundary)
    && value.boundary.every((item) => typeof item === 'string')
}

function isFutureOpportunity(value: unknown): boolean {
  return isRecord(value)
    && typeof value.version === 'string'
    && typeof value.generatedAt === 'string'
    && isFiniteNumber(value.targetDraftYear)
    && ['blocked', 'shadow', 'ready'].includes(String(value.status))
    && typeof value.reason === 'string'
    && typeof value.trainingEnabled === 'boolean'
    && typeof value.downstreamEnabled === 'boolean'
    && typeof value.phasePassed === 'boolean'
    && Array.isArray(value.boundary)
    && value.boundary.every((item) => typeof item === 'string')
}

function isRookieBoardBundle(value: unknown): value is RookieBoardBundle {
  if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.validation) || !isRecord(value.trainingEvidence)) return false
  return typeof value.version === 'string'
    && value.version.length > 0
    && typeof value.generatedAt === 'string'
    && Number.isFinite(Date.parse(value.generatedAt))
    && typeof value.mode === 'string'
    && typeof value.draftEvidenceEnabled === 'boolean'
    && value.tradeReturnForecastEnabled === false
    && typeof value.target.meaning === 'string'
    && ['backtest-passed', 'shadow', 'blocked'].includes(String(value.target.status))
    && Array.isArray(value.decisionBoundary)
    && value.decisionBoundary.every((item) => typeof item === 'string')
    && isFiniteNumber(value.trainingEvidence.examples)
    && Array.isArray(value.trainingEvidence.classes)
    && value.trainingEvidence.classes.every(isFiniteNumber)
    && isFiniteNumber(value.trainingEvidence.historicalCollegeCoverage)
    && isFiniteNumber(value.trainingEvidence.currentCollegeCoverage)
    && isFiniteNumber(value.validation.eligibleClasses)
    && isFiniteNumber(value.validation.classWins)
    && isFiniteNumber(value.validation.meanBasketLift)
    && isFiniteNumber(value.validation.minimumClassLift)
    && isFiniteNumber(value.validation.signTestPValue)
    && isFiniteNumber(value.validation.fullModelMae)
    && isFiniteNumber(value.validation.fullModelSpearman)
    && isFiniteNumber(value.validation.marketOnlyMae)
    && isFiniteNumber(value.validation.marketOnlySpearman)
    && isFiniteNumber(value.validation.meanLiftOverLearnedCapitalModel)
    && isFiniteNumber(value.validation.learnedCapitalModelClassWins)
    && Array.isArray(value.validation.classResults)
    && value.validation.classResults.every(isClassResult)
    && Array.isArray(value.board)
    && value.board.length > 0
    && value.board.every(isRookiePlayer)
    && new Set(value.board.map((player) => player.id)).size === value.board.length
    && isPickOpportunity(value.pickOpportunity)
    && isFutureOpportunity(value.futureClassOpportunity)
    && Array.isArray(value.promotionBlockers)
    && value.promotionBlockers.every((item) => typeof item === 'string')
}

export async function rookieResponse(
  request: Request,
  _env?: Env,
  artifact: unknown = rookieBoardArtifact,
  futureArtifact: unknown = futureRookieStatus,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  if (!authenticatedUser(request)) return privateJson({ message: 'Authenticated site access required' }, 401)
  const combined = isRecord(artifact) ? { ...artifact, futureClassOpportunity: futureArtifact } : artifact
  if (!isRookieBoardBundle(combined)) {
    return privateJson({ message: 'Validated rookie evidence is temporarily unavailable' }, 503)
  }
  if (!combined.draftEvidenceEnabled || combined.target.status !== 'backtest-passed') {
    return privateJson({ message: 'Validated rookie evidence is currently disabled' }, 503)
  }
  return privateJson(combined)
}
