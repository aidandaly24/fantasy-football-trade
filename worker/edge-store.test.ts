import { describe, expect, it } from 'vitest'
import { normalizeOfferInput, normalizeOpportunityInput } from './edge-store'

describe('private edge research storage', () => {
  it('creates a server-dated, bounded daily opportunity snapshot', () => {
    const snapshot = normalizeOpportunityInput({
      assetId: '11625', assetName: 'Target RB', ownerRosterId: 4,
      currentValue: 450, projection30: 470, projection90: 510, projection180: 525,
      edgeScore: 78, lineupDelta: 3.2, confidence: 71, categories: ['value', 'points', 'value'],
      catalyst: 'Named the starter before the market moved.',
    }, new Date('2026-08-10T12:00:00Z'))
    expect(snapshot.snapshotKey).toBe('4:11625:2026-08-10')
    expect(snapshot.categories).toEqual(['value', 'points'])
    expect(snapshot.status).toBe('tracking')
  })

  it('normalizes an offer and rejects an unsupported status', () => {
    const input = {
      offerId: 'offer-1', counterpartRosterId: 4, targetAssetId: '11625', targetAssetName: 'Target RB',
      stage: 'opening', status: 'sent', sentAssets: [{ id: 'pick', name: '2027 2nd', value: 300 }],
      receiveAssets: [{ id: '11625', name: 'Target RB', value: 450 }], marketDelta: 150, lineupDelta: 3.2,
      thesis: 'Adds points while the seller accumulates picks.',
    }
    expect(normalizeOfferInput(input, new Date('2026-08-10T12:00:00Z'))).toMatchObject({ status: 'sent', stage: 'opening' })
    expect(() => normalizeOfferInput({ ...input, status: 'won' })).toThrow('Invalid offer status')
  })

  it('rejects client payloads outside the score and value bounds', () => {
    expect(() => normalizeOpportunityInput({
      assetId: 'x', assetName: 'X', ownerRosterId: 2, currentValue: 2,
      projection30: 2, projection90: 2, projection180: 2, edgeScore: 101,
      lineupDelta: 0, confidence: 50, categories: ['value'], catalyst: 'x',
    })).toThrow('Invalid edge score')
  })
})
