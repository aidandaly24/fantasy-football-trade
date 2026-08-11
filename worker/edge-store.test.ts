import { describe, expect, it } from 'vitest'
import { normalizeOfferInput } from './edge-store'

describe('private edge research storage', () => {
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
})
