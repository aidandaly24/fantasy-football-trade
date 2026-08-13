import { describe, expect, it } from 'vitest'
import { nflWeekCloseDate, normalizeFantasyCalcHistory, reconstructTeamPlayerHistory } from './team-history'

describe('historical team player value', () => {
  it('anchors Sleeper weeks to their settled Tuesday without a capture-time backdate', () => {
    expect(nflWeekCloseDate('2025', 1)).toBe('2025-09-09')
    expect(nflWeekCloseDate('2025', 18)).toBe('2026-01-06')
    expect(nflWeekCloseDate('nope', 1)).toBeNull()
  })

  it('normalizes FantasyCalc dates and stores a bounded weekly tape', () => {
    const history = Array.from({ length: 17 }, (_, index) => ({
      date: `07/${String(index + 1).padStart(2, '0')}/2025`, value: 100 + index,
    }))
    expect(normalizeFantasyCalcHistory(history).map((point) => point.observedAt)).toEqual([
      '2025-07-01', '2025-07-08', '2025-07-15', '2025-07-17',
    ])
  })

  it('uses the historical owner and roster while exposing incomplete coverage', () => {
    const points = reconstructTeamPlayerHistory([{
      season: '2025', week: 1, rosterId: 7, ownerUserId: 'old-owner', players: ['a', 'b', 'missing'],
    }], [
      { assetId: 'a', observedAt: '2025-09-08', value: 400 },
      { assetId: 'b', observedAt: '2025-09-02', value: 300 },
      { assetId: 'b', observedAt: '2025-09-09', value: 320 },
    ])
    expect(points).toEqual([expect.objectContaining({
      observedAt: '2025-09-09', ownerUserId: 'old-owner', rosterId: 7,
      playerValue: 720, coveredPlayers: 2, rosterPlayers: 3, coverageRate: 2 / 3,
    })])
  })

  it('never applies a future value or stale value to an old roster', () => {
    const [point] = reconstructTeamPlayerHistory([{
      season: '2025', week: 1, rosterId: 1, ownerUserId: 'owner', players: ['future', 'stale'],
    }], [
      { assetId: 'future', observedAt: '2025-09-10', value: 999 },
      { assetId: 'stale', observedAt: '2025-08-01', value: 999 },
    ])
    expect(point.playerValue).toBe(0)
    expect(point.coverageRate).toBe(0)
  })
})
