import { describe, expect, it } from 'vitest'
import { buildTrainingTapeExport, normalizeFantasyCalcTrades, selectFantasyCalcAnchors } from './trade-tape-store'

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

  it('exports a stable, sanitized dataset identity independent of export time and input order', async () => {
    const trades = normalizeFantasyCalcTrades([
      { id: 'trade-2', date: '2026-08-11T14:00:00Z', leagueId: 'b', numQbs: 2, numTeams: 12, ppr: 1, side1: [{ id: 3, name: 'C', position: 'WR' }], side2: [{ id: 4, name: 'D', position: 'RB' }] },
      { id: 'trade-1', date: '2026-08-10T14:00:00Z', leagueId: 'a', numQbs: 1, numTeams: 10, ppr: 0.5, usernameSide1: 'private', side1: [{ id: 1, name: 'A', position: 'QB' }], side2: [{ id: 2, name: 'B', position: 'PICK' }] },
    ])
    const state = { source: 'FantasyCalc completed trades', status: 'ready', lastAttemptAt: null, lastSuccessAt: '2026-08-12T00:00:00Z', totalTrades: 2, uniqueLeagues: 2, firstTradeAt: trades[0].date, latestTradeAt: trades[1].date, latestRun: null } as const
    const first = await buildTrainingTapeExport(trades, state, '2026-08-12T01:00:00Z')
    const second = await buildTrainingTapeExport([...trades].reverse(), state, '2026-08-13T01:00:00Z')
    expect(first.datasetId).toBe(second.datasetId)
    expect(first.totalTrades).toBe(2)
    expect(first.uniqueLeagues).toBe(2)
    expect(first.trades.map((trade) => trade.id)).toEqual(['trade-1', 'trade-2'])
    expect(JSON.stringify(first)).not.toContain('username')
  })
})
