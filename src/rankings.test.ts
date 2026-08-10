import { describe, expect, it } from 'vitest'
import { buildOwnedPicks, evaluateTrade, optimizeLineup, packageValue } from './rankings'
import type { Asset, PickValue } from './types'

function asset(id: string, position: Asset['position'], value: number): Asset {
  return {
    id,
    name: id,
    kind: 'player',
    position,
    team: null,
    value,
    confidence: 1,
    age: null,
    rank: null,
  }
}

describe('optimizeLineup', () => {
  it('fills Superflex with a second quarterback while preserving required slots', () => {
    const players = [
      asset('qb1', 'QB', 900),
      asset('qb2', 'QB', 700),
      asset('rb1', 'RB', 650),
      asset('rb2', 'RB', 500),
      asset('wr1', 'WR', 800),
      asset('wr2', 'WR', 600),
      asset('te1', 'TE', 550),
    ]
    const lineup = optimizeLineup(players, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'])

    expect(lineup.map((player) => player.id)).toEqual(['qb1', 'rb1', 'wr1', 'te1', 'wr2', 'qb2'])
    expect(new Set(lineup.map((player) => player.id)).size).toBe(lineup.length)
  })
})

describe('buildOwnedPicks', () => {
  const pickValues: PickValue[] = [
    { id: 'pick_2026_1_02', name: '2026 Pick 1.02', round: 1, slot: 2, year: '2026', tier: 'early', composite: 500, position: 'PICK' },
    { id: 'pick_2026_1_06', name: '2026 Pick 1.06', round: 1, slot: 6, year: '2026', tier: 'mid', composite: 390, position: 'PICK' },
    { id: 'pick_2027_1_01', name: '2027 Pick 1.01', round: 1, slot: 1, year: '2027', tier: 'early', composite: 600, position: 'PICK' },
  ]

  it('moves a traded pick to its current owner and keeps the original slot identity', () => {
    const picks = buildOwnedPicks({
      season: 2026,
      rounds: 1,
      rosterIds: [1, 2],
      tradedPicks: [{ season: '2026', round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 }],
      pickValues,
      slotToRosterId: { '2': 1, '6': 2 },
      teamNames: new Map([[1, 'Alpha'], [2, 'Bravo']]),
    })

    expect(picks.get(1)?.some((pick) => pick.id === 'pick:2026:1:1')).toBe(false)
    const traded = picks.get(2)?.find((pick) => pick.id === 'pick:2026:1:1')
    expect(traded?.name).toBe('2026 1.02')
    expect(traded?.value).toBe(500)
  })
})

describe('trade evaluation', () => {
  it('applies diminishing weight to additional package pieces', () => {
    const elite = [asset('elite', 'WR', 900)]
    const packageAssets = [asset('a', 'RB', 260), asset('b', 'WR', 260), asset('c', 'TE', 260)]

    expect(packageValue(elite)).toBeGreaterThan(packageValue(packageAssets))
    expect(evaluateTrade(elite, packageAssets).verdict).toContain('Side A')
  })

  it('calls nearly equal adjusted packages fair', () => {
    const result = evaluateTrade([asset('a', 'QB', 500)], [asset('b', 'RB', 490)])
    expect(result.fair).toBe(true)
    expect(result.verdict).toBe('Dead even')
  })
})
