import { describe, expect, it } from 'vitest'
import { formatAssetValue } from './domain-ui'
import type { Asset } from '../types'

function player(overrides: Partial<Asset> = {}): Asset {
  return {
    id: '101', name: 'Player', kind: 'player', position: 'WR', team: 'NFL',
    value: 0, confidence: 0, age: null, rank: null, ...overrides,
  }
}

describe('formatAssetValue', () => {
  it('does not present a missing provider row as a real zero price', () => {
    expect(formatAssetValue(player({ marketValueAvailable: false }))).toBe('Unpriced')
    expect(formatAssetValue(player({ marketValueAvailable: true, value: 321 }))).toBe('321')
  })
})
