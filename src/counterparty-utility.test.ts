import { describe, expect, it } from 'vitest'
import { buildCounterpartyNegotiationBook, buildCounterpartyRosterRead } from './counterparty-utility'
import type { ComparablePackage } from './strategy'
import type { Asset, Team } from './types'

function player(id: string, position: Asset['position'], value: number, currentSeasonValue = value): Asset {
  return { id, name: id, kind: 'player', position, team: 'TST', value, confidence: 1, age: 24, rank: 1, currentSeasonValue }
}

function pick(id: string, value: number): Asset {
  return { id, name: id, kind: 'pick', position: 'PICK', team: null, value, confidence: 1, age: null, rank: null, year: '2027', round: 1 }
}

function team(rosterId: number, players: Asset[], picks: Asset[] = [], starters = players.slice(0, 2)): Team {
  return {
    rosterId, ownerId: String(rosterId), ownerName: `owner-${rosterId}`, teamName: `team-${rosterId}`,
    avatar: null, players, picks, optimizedStarters: starters,
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

function packageRow(send: Asset[], receive: Asset[], sendValue: number, receiveValue: number, powerThem: number | null): ComparablePackage {
  return {
    key: send.map((asset) => asset.id).join('+'), send, receive, sendValue, receiveValue,
    marketNetToMe: receiveValue - sendValue, marketGapPercent: (sendValue - receiveValue) / receiveValue,
    marketDistancePercent: Math.abs(sendValue - receiveValue) / receiveValue, lineupDeltaMe: null, lineupDeltaThem: null,
    lineupCoveragePercent: 0, currentSeasonPowerDeltaMe: null, currentSeasonPowerDeltaThem: powerThem,
    currentSeasonCoveragePercent: 100, projectionCoverage: 0, rangeMe: { worst: 0, best: 0 },
    providerNetToMe: { ktc: null, fantasycalc: null }, draftCapitalSent: send.filter((asset) => asset.kind === 'pick').reduce((sum, asset) => sum + asset.value, 0),
    draftCapitalReceived: 0, draftCapitalNetToMe: 0, outgoingAverageAgeAtHorizon: null,
    incomingAverageAgeAtHorizon: null, portfolio: null, frontier: true, tradeoffs: [],
  }
}

describe('counterparty utility', () => {
  it('derives needs and surplus from the league population', () => {
    const teams = [
      team(1, [player('my-qb', 'QB', 600), player('my-wr', 'WR', 800)]),
      team(2, [player('seller-qb', 'QB', 100), player('seller-rb', 'RB', 900), player('seller-rb-2', 'RB', 700)]),
      team(3, [player('third-qb', 'QB', 500), player('third-rb', 'RB', 200), player('third-wr', 'WR', 600)]),
    ]
    const read = buildCounterpartyRosterRead(teams, 2)!
    expect(read.needPositions).toContain('QB')
    expect(read.surplusPositions).toContain('RB')
  })

  it('keeps price anchors separate while explaining seller utility', () => {
    const target = player('target-rb', 'RB', 900)
    const qb = player('incoming-qb', 'QB', 650)
    const extra = pick('incoming-pick', 180)
    const teams = [
      team(1, [qb], [extra]),
      team(2, [player('seller-qb', 'QB', 100), target, player('seller-rb-2', 'RB', 700)]),
      team(3, [player('median-qb', 'QB', 600), player('median-rb', 'RB', 200)]),
    ]
    const rows = [
      packageRow([qb], [target], 650, 900, -10),
      packageRow([qb, extra], [target], 830, 900, 5),
    ]
    const book = buildCounterpartyNegotiationBook({ teams, myRosterId: 1, counterpartRosterId: 2, target, packages: rows })!
    expect(book.stages.map((stage) => stage.stage)).toEqual(['ambitious-opening', 'fair-target'])
    expect(book.stages[1].fillsNeedWith).toContain('incoming-qb')
    expect(book.stages[1].whyTheyMightConsider.some((item) => item.includes('lineup power improves'))).toBe(true)
    expect(book.method).toContain('never converted into acceptance odds')
  })

  it('only proposes a bounded bridge when every direct package misses seller utility', () => {
    const target = player('target-rb', 'RB', 900)
    const myWr = player('my-wr', 'WR', 700)
    const bridgeQb = player('bridge-qb', 'QB', 780)
    const teams = [
      team(1, [myWr, player('my-qb', 'QB', 200)]),
      team(2, [player('seller-qb', 'QB', 100), target, player('seller-rb-2', 'RB', 700), player('seller-wr', 'WR', 400)]),
      team(3, [player('third-wr', 'WR', 100), bridgeQb, player('third-rb', 'RB', 1800)], [], [player('third-wr', 'WR', 100), player('third-rb', 'RB', 1800)]),
    ]
    const book = buildCounterpartyNegotiationBook({
      teams, myRosterId: 1, counterpartRosterId: 2, target,
      packages: [packageRow([myWr], [target], 700, 900, -20)],
    })!
    expect(book.directUtilityMismatch).toBe(true)
    expect(book.threeWayBridges).toHaveLength(1)
    expect(book.threeWayBridges[0].bridgeToSeller.id).toBe('bridge-qb')
    expect(book.threeWayBridges[0].marketLedger.reduce((sum, row) => sum + row.net, 0)).toBe(0)
  })
})
