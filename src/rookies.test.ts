import { describe, expect, it } from 'vitest'
import { rookiePlayerKey, selectRookieBoardPlayers, type RookieBoardPlayer } from './rookies'

function player(overrides: Partial<RookieBoardPlayer>): RookieBoardPlayer {
  return {
    id: 'rookie-1',
    sleeperId: '1',
    name: 'Alpha Runner',
    position: 'RB',
    nflTeam: 'NYJ',
    college: 'Example State',
    draftBoardRank: 1,
    rookieMarketRank: 4,
    lateCandidate: false,
    inValidatedSleeperBasket: false,
    expectedRookieProductionPercentile: 0.8,
    marketOnlyExpectedProductionPercentile: 0.7,
    evidenceAdjustment: 0.1,
    modelDisagreement: 0.05,
    historicalResidualBand80: { lower: 0.5, upper: 1, meaning: 'historical error' },
    evidence: {
      nflDraftOverall: 20,
      collegeSeasonsObserved: 3,
      finalCollegeScrimmageShare: 0.3,
      maxCollegeScrimmageShare: 0.35,
      finalCollegeTargetShare: 0.15,
      forty: 4.45,
      collegeDataPresent: true,
      combineDataPresent: true,
    },
    ...overrides,
  }
}

describe('rookie board selection', () => {
  const board = [
    player({ id: 'rookie-1', sleeperId: '1', name: 'Alpha Runner', position: 'RB', draftBoardRank: 2, rookieMarketRank: 30, inValidatedSleeperBasket: true, expectedRookieProductionPercentile: 0.75, evidenceAdjustment: 0.2 }),
    player({ id: 'rookie-2', sleeperId: '2', name: 'Beta Wide', position: 'WR', draftBoardRank: 1, rookieMarketRank: 5, expectedRookieProductionPercentile: 0.9, evidenceAdjustment: -0.01 }),
    player({ id: 'rookie-3', sleeperId: null, name: 'Gamma Tight End', position: 'TE', draftBoardRank: 3, rookieMarketRank: 35, inValidatedSleeperBasket: true, expectedRookieProductionPercentile: 0.7, evidenceAdjustment: 0.1 }),
  ]

  it('filters to the exact validated basket and position', () => {
    expect(selectRookieBoardPlayers(board, { basketOnly: true, position: 'RB', sort: 'board' }).map(rookiePlayerKey)).toEqual(['rookie-1'])
  })

  it('supports every declared sort without changing stable identity', () => {
    expect(selectRookieBoardPlayers(board, { basketOnly: false, position: 'ALL', sort: 'board' }).map(rookiePlayerKey)).toEqual(['rookie-2', 'rookie-1', 'rookie-3'])
    expect(selectRookieBoardPlayers(board, { basketOnly: false, position: 'ALL', sort: 'market' }).map(rookiePlayerKey)).toEqual(['rookie-2', 'rookie-1', 'rookie-3'])
    expect(selectRookieBoardPlayers(board, { basketOnly: false, position: 'ALL', sort: 'production' }).map(rookiePlayerKey)).toEqual(['rookie-2', 'rookie-1', 'rookie-3'])
    expect(selectRookieBoardPlayers(board, { basketOnly: false, position: 'ALL', sort: 'adjustment' }).map(rookiePlayerKey)).toEqual(['rookie-1', 'rookie-3', 'rookie-2'])
  })
})
