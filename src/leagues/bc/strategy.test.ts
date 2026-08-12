import { describe, expect, it } from 'vitest'
import type { Asset } from '../../types'
import { evaluateLeagueTradePolicy, strategyProfileForLeague } from '..'
import { BC_LEAGUE_ID, bcStrategy } from './strategy'

function player(id: string): Asset {
  return {
    id,
    name: id,
    kind: 'player',
    position: 'QB',
    team: null,
    value: 500,
    confidence: 1,
    age: 24,
    rank: null,
  }
}

function pick(id: string, year: number, round: number, slot?: number): Asset {
  return {
    id,
    name: id,
    kind: 'pick',
    position: 'PICK',
    team: null,
    value: 500,
    confidence: 1,
    age: null,
    rank: null,
    year: String(year),
    round,
    slot,
  }
}

describe('BC private value-build policy', () => {
  it('applies only to Aidan roster 2 in the fixed BC league', () => {
    expect(strategyProfileForLeague(BC_LEAGUE_ID, 2)).toBe(bcStrategy)
    expect(strategyProfileForLeague(BC_LEAGUE_ID, 5)).toBeNull()
    expect(bcStrategy.kind).toBe('value-build')
  })

  it('clears the Burden pick swap because value, power, and first-round liquidity improve or hold', () => {
    const decision = evaluateLeagueTradePolicy(bcStrategy, {
      marketNetToMe: 300,
      currentSeasonPowerDelta: 78,
      outgoing: [player('Kenny Gainwell'), pick('own-2027-first', 2027, 1)],
      incoming: [player('Luther Burden'), pick('Marco-2027-first', 2027, 1)],
    })

    expect(decision.status).toBe('pass')
  })

  it('blocks the McCarthy deal regression when market, power, and a pick all leave', () => {
    const decision = evaluateLeagueTradePolicy(bcStrategy, {
      marketNetToMe: -146,
      currentSeasonPowerDelta: -199,
      outgoing: [player('Kyler Murray'), pick('2026-third', 2026, 3)],
      incoming: [player('J.J. McCarthy')],
    })

    expect(decision.status).toBe('block')
    expect(decision.title).toContain('triple-loss')
  })

  it('reviews an unmatched protected pick even when the hard veto does not fire', () => {
    const decision = evaluateLeagueTradePolicy(bcStrategy, {
      marketNetToMe: 200,
      currentSeasonPowerDelta: 50,
      outgoing: [pick('2026-1.02', 2026, 1, 2)],
      incoming: [player('young-starter')],
    })

    expect(decision.status).toBe('review')
    expect(decision.reasons.join(' ')).toContain('2026 1.02')
  })
})
