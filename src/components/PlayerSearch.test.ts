import { describe, expect, it } from 'vitest'
import type { Asset, Team } from '../types'
import { searchRosteredPlayers } from './PlayerSearch'

function player(id: string, name: string, value: number, position: Asset['position'] = 'WR'): Asset {
  return { id, name, kind: 'player', position, team: 'NE', value, confidence: 1, age: 23, rank: value }
}

function team(rosterId: number, ownerName: string, players: Asset[]): Team {
  return { rosterId, ownerId: String(rosterId), ownerName, teamName: `${ownerName} team`, avatar: null, players, picks: [], optimizedStarters: [], metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 } }
}

describe('rostered player search', () => {
  const teams = [team(1, 'aidan', [player('1', 'Luther Burden', 600)]), team(2, 'jon', [player('2', 'Josh Allen', 900, 'QB'), player('3', 'Allen Lazard', 100)])]

  it('finds by player name and puts prefix matches first', () => {
    expect(searchRosteredPlayers(teams, 'allen').map((row) => row.player.name)).toEqual(['Allen Lazard', 'Josh Allen'])
  })

  it('finds by manager and respects the result cap', () => {
    expect(searchRosteredPlayers(teams, 'jon', 1).map((row) => row.owner.ownerName)).toEqual(['jon'])
  })

  it('does not populate results before the user searches', () => {
    expect(searchRosteredPlayers(teams, ' ')).toEqual([])
  })
})
