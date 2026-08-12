import { describe, expect, it } from 'vitest'
import { normalizeFantasyCalcTrades, selectFantasyCalcAnchors } from './trade-tape-store'

function catalog() {
  return ['QB', 'RB', 'WR', 'TE'].flatMap((position, positionIndex) =>
    Array.from({ length: 25 }, (_, index) => ({
      value: 10_000 - positionIndex * 100 - index,
      player: { id: positionIndex * 100 + index + 1, position },
    })),
  )
}

describe('FantasyCalc trade tape collection', () => {
  it('selects a deterministic value-stratified anchor population across positions', () => {
    const first = selectFantasyCalcAnchors(catalog(), 40)
    const second = selectFantasyCalcAnchors([...catalog()].reverse(), 40)
    expect(first).toEqual(second)
    expect(first).toHaveLength(40)
    expect(first.filter((id) => id < 100)).toHaveLength(10)
    expect(first.filter((id) => id >= 100 && id < 200)).toHaveLength(10)
    expect(first.filter((id) => id >= 200 && id < 300)).toHaveLength(10)
    expect(first.filter((id) => id >= 300)).toHaveLength(10)
  })

  it('deduplicates trades and stores only the model fields instead of provider usernames', () => {
    const trade = {
      id: 'trade-1',
      date: '2026-08-11T13:01:01.920Z',
      leagueId: 'league-a',
      numQbs: 2,
      numTeams: 12,
      ppr: 1,
      tePremium: 0,
      numStarters: 9,
      rosterSize: 24,
      usernameSide1: 'not-stored',
      side1: [{ id: 1, name: 'Elite', position: 'WR', maybeAge: 23.2, maybeBirthday: '2003-01-01' }],
      side2: [
        { id: 2, name: 'Piece A', position: 'RB', maybeAge: 22.1 },
        { id: 3, name: 'Piece B', position: 'PICK' },
      ],
    }
    const rows = normalizeFantasyCalcTrades([trade, { ...trade, usernameSide1: 'also-not-stored' }])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'trade-1', numQbs: 2, side1: [{ id: 1 }], side2: [{ id: 2 }, { id: 3 }] })
    expect(JSON.stringify(rows[0])).not.toContain('username')
  })

  it('drops malformed rows instead of poisoning the tape', () => {
    expect(normalizeFantasyCalcTrades([
      { id: '', date: 'bad', side1: [], side2: [] },
      { id: 'missing-side', date: '2026-08-11', side1: [{ id: 1, name: 'A', position: 'QB' }] },
    ])).toEqual([])
  })
})
