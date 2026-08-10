import { describe, expect, it } from 'vitest'
import {
  auditHistoricalTrainingExamples,
  buildHistoricalTrainingExamples,
  buildResearchPipeline,
  reconstructLeagueWeekStates,
  type HistoricalMarketPoint,
} from './research'

const day = 86_400_000

function date(offset: number): string {
  return new Date(Date.UTC(2024, 0, 1) + offset * day).toISOString()
}

describe('historical research pipeline', () => {
  it('reconstructs cumulative records without mixing matchup opponents', () => {
    const states = reconstructLeagueWeekStates({
      leagueId: 'league-1',
      season: '2024',
      ownerByRoster: new Map([[1, 'a'], [2, 'b']]),
      weeks: [
        { week: 1, matchups: [
          { rosterId: 1, matchupId: 1, players: ['p1'], starters: ['p1'], points: 110 },
          { rosterId: 2, matchupId: 1, players: ['p2'], starters: ['p2'], points: 100 },
        ] },
        { week: 2, matchups: [
          { rosterId: 1, matchupId: 1, players: ['p1'], starters: ['p1'], points: 90 },
          { rosterId: 2, matchupId: 1, players: ['p2'], starters: ['p2'], points: 105 },
        ] },
      ],
    })

    expect(states.find((row) => row.rosterId === 1 && row.week === 2)).toMatchObject({
      ownerUserId: 'a', wins: 1, losses: 1, pointsAgainst: 105,
    })
    expect(states.find((row) => row.rosterId === 2 && row.week === 2)).toMatchObject({ wins: 1, losses: 1 })
  })

  it('uses only features known at the anchor while reserving future data for the label', () => {
    const market: HistoricalMarketPoint[] = [
      { assetId: 'p1', assetName: 'Player One', position: 'WR', observedAt: date(0), value: 100 },
      { assetId: 'p1', assetName: 'Player One', position: 'WR', observedAt: date(30), value: 110 },
      { assetId: 'p1', assetName: 'Player One', position: 'WR', observedAt: date(60), value: 121 },
    ]
    const examples = buildHistoricalTrainingExamples(market, [
      { assetId: 'p1', observedAt: date(29), team: 'MIN', active: true, status: 'Active', injuryStatus: null, depthChartOrder: 1 },
      { assetId: 'p1', observedAt: date(31), team: 'MIN', active: false, status: 'Reserve', injuryStatus: 'Out', depthChartOrder: 4 },
    ], [
      { playerId: 'p1', publishedAt: date(28), eventType: 'role-up', direction: 'up', impactWeight: 4 },
      { playerId: 'p1', publishedAt: date(31), eventType: 'injury', direction: 'down', impactWeight: 5 },
    ])

    const anchor = examples.find((row) => row.asOf === date(30))!
    expect(anchor.objectiveObservedAt).toBe(date(29))
    expect(anchor.active).toBe(true)
    expect(anchor.newsCount7).toBe(1)
    expect(anchor.latestNewsAt).toBe(date(28))
    expect(anchor.return30).toBeCloseTo(0.1)
    expect(auditHistoricalTrainingExamples(examples).leakageViolations).toBe(0)
  })

  it('keeps incomplete phases collecting and never promotes shadow challengers', () => {
    const pipeline = buildResearchPipeline({
      generatedAt: date(100), leagueId: 'league-1', lastLeagueSyncAt: date(99),
      seasons: 3, expectedRosterWeeks: 600, rosterWeeks: 570,
      objectiveSourceSeasons: 3, objectiveHistoricalRows: 10_000,
      objectiveTrackedPlayers: 50, objectiveObservations: 50, objectiveLastObservedAt: date(99),
      training: { examples: 500, uniqueAssets: 40, dateSpanDays: 500, objectiveCoverage: 0.1, newsCoverage: 0.01, leakageViolations: 0 },
      shadow: { trainingRows: 400, validationRows: 100, maeLift: 0.08, productionEnabled: false },
      managers: 12, completedTrades: 30, reliableManagers: 4, identityCoverage: 1,
      storedNewsEvents: 20, matchedNewsExamples: 2, newsSourceCount: 3, newsHeldOutLift: null,
    })

    expect(pipeline.phases.find((phase) => phase.version === '5.1')?.status).toBe('ready')
    expect(pipeline.phases.find((phase) => phase.version === '5.3')?.status).toBe('collecting')
    expect(pipeline.phases.find((phase) => phase.version === '5.4')).toMatchObject({ status: 'shadow', productionEnabled: false })
    expect(pipeline.phases.find((phase) => phase.version === '5.6')?.productionEnabled).toBe(false)
  })
})
