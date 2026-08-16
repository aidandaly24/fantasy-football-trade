import { describe, expect, it } from 'vitest'
import {
  americanOddsToProbability,
  buildSportsbookConsensus,
  consensusForPlayer,
  normalizeSportsbookPlayerName,
  removeTwoWayVig,
  type SportsbookLineObservation,
} from './sportsbook'

describe('sportsbook normalization', () => {
  it('matches punctuation and player suffix differences without fuzzy guessing', () => {
    expect(normalizeSportsbookPlayerName('Brian Thomas Jr.')).toBe(normalizeSportsbookPlayerName('Brian Thomas'))
    expect(normalizeSportsbookPlayerName("Ja'Marr Chase")).toBe('jamarrchase')
  })

  it('converts American odds and removes two-way vig', () => {
    expect(americanOddsToProbability(-110)).toBeCloseTo(0.52381, 5)
    expect(americanOddsToProbability(150)).toBeCloseTo(0.4, 5)
    expect(removeTwoWayVig(-110, -110)).toEqual([0.5, 0.5])
  })

  it('uses the median line and only de-vigs paired prices at the same book and point', () => {
    const observations: SportsbookLineObservation[] = [
      { bookmaker: 'a', market: 'player_reception_yds', participant: 'Malik Nabers', outcome: 'Over', price: -115, point: 72.5, updatedAt: '2026-09-10T12:00:00Z' },
      { bookmaker: 'a', market: 'player_reception_yds', participant: 'Malik Nabers', outcome: 'Under', price: -105, point: 72.5, updatedAt: '2026-09-10T12:00:00Z' },
      { bookmaker: 'b', market: 'player_reception_yds', participant: 'Malik Nabers', outcome: 'Over', price: -110, point: 74.5, updatedAt: '2026-09-10T12:05:00Z' },
      { bookmaker: 'b', market: 'player_reception_yds', participant: 'Malik Nabers', outcome: 'Under', price: -110, point: 74.5, updatedAt: '2026-09-10T12:05:00Z' },
    ]
    const consensus = buildSportsbookConsensus('player_reception_yds', observations)
    expect(consensus?.line).toBe(73.5)
    expect(consensus?.lineLow).toBe(72.5)
    expect(consensus?.lineHigh).toBe(74.5)
    expect(consensus?.bookmakerCount).toBe(2)
    expect(consensus?.overProbability).toBeGreaterThan(0.5)
    expect(consensus?.observedAt).toBe('2026-09-10T12:05:00Z')
  })

  it('never assigns another player by partial-name similarity', () => {
    const observations: SportsbookLineObservation[] = [
      { bookmaker: 'a', market: 'player_rush_yds', participant: 'Josh Allen', outcome: 'Over', price: -110, point: 44.5, updatedAt: null },
      { bookmaker: 'a', market: 'player_rush_yds', participant: 'Josh Allen', outcome: 'Under', price: -110, point: 44.5, updatedAt: null },
    ]
    expect(consensusForPlayer('Josh Allen', observations)).toHaveLength(1)
    expect(consensusForPlayer('Josh', observations)).toHaveLength(0)
  })
})
