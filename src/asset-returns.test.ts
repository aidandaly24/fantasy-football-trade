import { describe, expect, it } from 'vitest'
import {
  assetReturnEvidence,
  buildAssetReturnIndex,
  evaluateRebuildPortfolioTrade,
  summarizePortfolio,
  type AssetReturnAsset,
  type AssetReturnHealthBundle,
} from './asset-returns'
import type { Asset, Team } from './types'

function player(id: string, value: number, age = 24): Asset {
  return { id, name: `Player ${id}`, kind: 'player', position: 'WR', team: 'NE', value, confidence: 1, age, rank: 1 }
}

function pick(value: number): Asset {
  return {
    id: 'pick:2027:1:1', name: '2027 1st · from Team', kind: 'pick', position: 'PICK', team: null,
    value, confidence: 0, age: null, rank: null, year: '2027', round: 1, projectedTier: 'mid',
  }
}

function returnAsset(overrides: Partial<AssetReturnAsset>): AssetReturnAsset {
  return {
    fantasyCalcId: 1, sleeperId: 'a', name: 'Player a', position: 'WR', format: '2qb', currentValue: 100,
    overallRank: 1, age: 24, tradeFrequency: 0.02, consensusVariancePercent: null,
    risk: { observed30dReturn: 0.05, observed90dReturn: 0.1, monthlyVolatility30d: 0.1, maxDrawdown90d: -0.1, maxDrawdown180d: -0.2, observations180d: 181 },
    horizons: {
      '30': { status: 'validated', enabled: true, expectedReturn: 0.1, trackedAssetLower: -0.2, trackedAssetUpper: 0.3 },
      '90': { status: 'shadow', enabled: false }, '180': { status: 'needs-data', enabled: false }, '365': { status: 'needs-data', enabled: false },
    },
    ...overrides,
  }
}

function bundle(): AssetReturnHealthBundle {
  const a = returnAsset({ sleeperId: 'a', name: 'Player a' })
  const b = returnAsset({ fantasyCalcId: 2, sleeperId: 'b', name: 'Player b', tradeFrequency: 0.01, horizons: {
    '30': { status: 'validated', enabled: true, expectedReturn: -0.05, trackedAssetLower: -0.3, trackedAssetUpper: 0.2 },
    '90': { status: 'shadow', enabled: false }, '180': { status: 'needs-data', enabled: false }, '365': { status: 'needs-data', enabled: false },
  } })
  const p = returnAsset({ fantasyCalcId: 3, sleeperId: null, name: '2027 1st (Mid)', position: 'PICK', age: null })
  return {
    schemaVersion: 1, generatedAt: '2026-08-12T00:00:00Z', dataAsOf: '2026-08-11',
    source: { name: 'FantasyCalc', methodology: 'x', terms: 'x', attribution: 'FantasyCalc', predictionBoundary: 'tracked assets' },
    sourceAudit: { datasetId: 'sha256:test', currentCatalogAssets: 3, historyAssets: 3, tradeObservedAssetsOutsideCurrentCatalog: 0, populationBoundary: 'tracked', survivorWarning: 'Failure risk is not complete.', formats: [] },
    models: [{
      format: '2qb', horizonDays: 30, target: 'return', status: 'validated', enabled: true, rows: 1000, assets: 300,
      anchorDates: 30, trainingRows: 800, testRows: 200, heldoutAssets: 200, trainSpanDays: 200,
      baselineName: 'zero', baseline: { mae: 1, rmse: 1, rankCorrelation: 0 }, modelMetrics: { mae: 0.9, rmse: 1, rankCorrelation: 0.2 },
      maeImprovement: 0.1, crossSectionRankCorrelation: 0.2, interval: { targetCoverage: 0.8, heldoutCoverage: 0.8, meanWidth: 0.5 },
      selectedModel: 'hist-gradient', cohorts: [{ position: 'WR', ageBand: '23–25', rows: 100, assets: 20, medianReturn: 0.02, p10Return: -0.2, p90Return: 0.3 }], gates: [],
    }],
    assets: { '2qb:1': a, '2qb:2': b, '2qb:3': p },
  }
}

function team(): Team {
  return {
    rosterId: 1, ownerId: '1', ownerName: 'Me', teamName: 'Me', avatar: null,
    players: [player('a', 100), player('b', 100)], picks: [pick(100)], optimizedStarters: [],
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

describe('rebuild portfolio evidence', () => {
  it('matches players by Sleeper id and unresolved picks by explicit midpoint', () => {
    const index = buildAssetReturnIndex(bundle(), 2)
    expect(assetReturnEvidence(player('a', 100), index)?.name).toBe('Player a')
    expect(assetReturnEvidence(pick(100), index)?.name).toBe('2027 1st (Mid)')
  })

  it('keeps expected return, tracked downside, age, liquidity, and concentration separate', () => {
    const summary = summarizePortfolio({ assets: [...team().players, ...team().picks], bundle: bundle(), numQbs: 2, horizonYears: 3 })
    expect(summary.currentValue).toBe(300)
    expect(summary.expectedPnl30).toBeCloseTo(15)
    expect(summary.trackedAssetLowerPnl30).toBeCloseTo(-70)
    expect(summary.returnSourceValue).toBe(300)
    expect(summary.pickValueShare).toBeCloseTo(1 / 3)
    expect(summary.concentrationHhi).toBeCloseTo(1 / 3)
    expect(summary.returnCoverage).toBe(1)
  })

  it('reports a factual rebuild portfolio delta without manufacturing a score', () => {
    const incoming = player('c', 200, 24)
    const outgoing = player('b', 100, 24)
    const result = evaluateRebuildPortfolioTrade({ team: team(), outgoing: [outgoing], incoming: [incoming], bundle: bundle(), numQbs: 2, horizonYears: 3 })
    expect(result.currentValue).toBe(100)
    expect(result.expectedPnl30).not.toBeNull()
    expect(result.after.expectedPnl30).toBeCloseTo(20)
    expect(result.returnCoverage).toBeCloseTo(0.5)
    expect(result).not.toHaveProperty('score')
    expect(result.notes.join(' ')).toContain('not complete')
  })
})
