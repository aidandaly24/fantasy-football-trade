import { describe, expect, it } from 'vitest'
import { buildLeagueDraftReview } from './draft-review'
import type { RookieBoardBundle, RookieBoardPlayer } from './rookies'
import type { LeagueBundle } from './types'

function rookie(id: string, name: string, rank: number, value: number, production: number): RookieBoardPlayer {
  return {
    id: `sleeper:${id}`, sleeperId: id, name, position: 'WR', nflTeam: 'NFL', college: 'College',
    draftBoardRank: rank, rookieMarketRank: rank, currentMarket: { rank, value, overallRank: null, team: 'NFL' },
    lateCandidate: false, inValidatedSleeperBasket: false, expectedRookieProductionPercentile: production,
    marketOnlyExpectedProductionPercentile: production, evidenceAdjustment: 0, modelDisagreement: 0,
    historicalResidualBand80: { lower: 0, upper: 1, meaning: 'test' },
    evidence: { nflDraftOverall: rank, collegeSeasonsObserved: 3, finalCollegeScrimmageShare: 0.2, maxCollegeScrimmageShare: 0.2, finalCollegeTargetShare: 0.2, forty: null, collegeDataPresent: true, combineDataPresent: false },
  }
}

function bundle(): LeagueBundle {
  return {
    league: { league_id: 'league', name: 'League', season: '2026', status: 'complete', total_rosters: 2, draft_id: 'draft', previous_league_id: null, avatar: null, roster_positions: [], scoring_settings: {}, settings: { num_teams: 2, draft_rounds: 1 } },
    rosters: [
      { roster_id: 1, owner_id: 'a', players: [], starters: [], reserve: [], taxi: [] },
      { roster_id: 2, owner_id: 'b', players: [], starters: [], reserve: [], taxi: [] },
    ],
    users: [
      { user_id: 'a', display_name: 'alpha', avatar: null },
      { user_id: 'b', display_name: 'beta', avatar: null },
    ],
    tradedPicks: [],
    draft: { draft_id: 'draft', season: '2026', status: 'complete', draft_order: null, slot_to_roster_id: null, settings: { teams: 2, rounds: 1 } },
    draftPicks: [
      { player_id: '2', picked_by: 'a', roster_id: 1, pick_no: 1, round: 1, draft_slot: 1, metadata: { first_name: 'Value', last_name: 'Pick', position: 'WR' } },
      { player_id: '1', picked_by: 'b', roster_id: 2, pick_no: 2, round: 1, draft_slot: 2, metadata: { first_name: 'Top', last_name: 'Pick', position: 'WR' } },
    ],
  }
}

function board(): RookieBoardBundle {
  return {
    version: 'test', generatedAt: '2026-08-10T00:00:00Z', mode: 'test', draftEvidenceEnabled: true,
    tradeReturnForecastEnabled: false, target: { meaning: 'production', status: 'backtest-passed' }, decisionBoundary: [],
    trainingEvidence: { examples: 1, classes: [2025], historicalCollegeCoverage: 1, currentCollegeCoverage: 1 },
    validation: { eligibleClasses: 1, classWins: 1, meanBasketLift: 0, minimumClassLift: 0, signTestPValue: 1, fullModelMae: 0, fullModelSpearman: 0, marketOnlyMae: 0, marketOnlySpearman: 0, meanLiftOverLearnedCapitalModel: 0, learnedCapitalModelClassWins: 0, classResults: [] },
    board: [rookie('1', 'Top Pick', 1, 100, 0.8), rookie('2', 'Value Pick', 2, 80, 0.7)],
    pickOpportunity: { class: 2026, status: 'advisory', advisoryOnly: true, availabilityMeaning: 'test', availabilityRules: [], targetMeaning: 'test', exactSlotPromotion: false, exact112Gate: { passed: false, eligibleClasses: 1, primaryAvailabilityClassWins: 0, exactOneSidedSignPValue: 1, requirement: 'test' }, slots: [], boundary: [] },
    futureClassOpportunity: { version: 'test', generatedAt: '2026-08-10T00:00:00Z', targetDraftYear: 2027, status: 'blocked', reason: 'test', trainingEnabled: false, downstreamEnabled: false, phasePassed: false, evaluableDraftYears: [], boundary: [] },
    promotionBlockers: [],
    currentMarket: { status: 'live', generatedAt: '2026-08-30T00:00:00Z', sources: ['tradyr'], attribution: 'Powered by Tradyr', format: { numQbs: 2, tep: true }, coverage: { expected: 2, returned: 2, complete: true } },
  }
}

describe('completed rookie draft review', () => {
  it('ranks total market haul first and keeps slot surplus as a separate execution rank', () => {
    const review = buildLeagueDraftReview(bundle(), board())
    expect(review.status).toBe('complete')
    expect(review.managers.map((manager) => manager.handle)).toEqual(['@beta', '@alpha'])
    expect(review.managers.find((manager) => manager.handle === '@alpha')).toMatchObject({
      currentMarketValue: 80,
      expectedSlotValue: 100,
      marketSurplus: -20,
      efficiencyRank: 2,
    })
    expect(review.managers.find((manager) => manager.handle === '@beta')).toMatchObject({
      currentMarketValue: 100,
      expectedSlotValue: 80,
      marketSurplus: 20,
      efficiencyRank: 1,
    })
  })

  it('withholds rankings when the draft or current market is incomplete', () => {
    const rookieBoard = board()
    rookieBoard.currentMarket = { ...rookieBoard.currentMarket!, status: 'unavailable', coverage: null }
    expect(buildLeagueDraftReview(bundle(), rookieBoard)).toMatchObject({ status: 'unavailable', managers: [] })
  })
})
