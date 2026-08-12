import type { RookieBoardBundle, RookiePickOpportunityCandidate } from './rookies'
import type { Asset } from './types'

export type PickOpportunityRead = {
  asset: Asset
  status: 'current-class-advisory' | 'current-class-unresolved' | 'future-class-blocked' | 'future-class-unavailable'
  title: string
  priceRange: { low: number; midpoint: number; high: number }
  candidates: RookiePickOpportunityCandidate[]
  evidence: string[]
  boundary: string[]
}

/** Converts a selected draft pick into a transparent opportunity-cost read. It
 * never turns production percentiles into pick prices or future-class values. */
export function buildPickOpportunityRead(asset: Asset, bundle: RookieBoardBundle | null): PickOpportunityRead | null {
  if (asset.kind !== 'pick' || !asset.year) return null
  const year = Number(asset.year)
  const priceRange = {
    low: asset.valueLow ?? asset.value,
    midpoint: asset.value,
    high: asset.valueHigh ?? asset.value,
  }
  if (!bundle) return {
    asset,
    status: 'future-class-unavailable',
    title: 'Rookie evidence unavailable',
    priceRange,
    candidates: [],
    evidence: ['The private rookie artifact is not loaded.'],
    boundary: ['Current market price remains the only usable pick evidence.'],
  }
  if (year === bundle.pickOpportunity.class) {
    if (!asset.slot) return {
      asset,
      status: 'current-class-unresolved',
      title: `${year} pick slot is unresolved`,
      priceRange,
      candidates: [],
      evidence: [bundle.pickOpportunity.availabilityMeaning],
      boundary: ['A candidate basket requires an exact slot; the current early/mid/late price range stays separate.'],
    }
    const slot = bundle.pickOpportunity.slots.find((candidate) => candidate.slot === asset.slot)
    return {
      asset,
      status: 'current-class-advisory',
      title: `${slot?.label ?? asset.name} production opportunity set`,
      priceRange,
      candidates: slot?.candidates ?? [],
      evidence: [
        bundle.pickOpportunity.availabilityMeaning,
        `Exact 1.12 richer-model gate: ${bundle.pickOpportunity.exact112Gate.primaryAvailabilityClassWins}/${bundle.pickOpportunity.exact112Gate.eligibleClasses} class wins; p=${bundle.pickOpportunity.exact112Gate.exactOneSidedSignPValue}.`,
      ],
      boundary: bundle.pickOpportunity.boundary,
    }
  }
  if (year === bundle.futureClassOpportunity.targetDraftYear) return {
    asset,
    status: 'future-class-blocked',
    title: `${year} class evidence is blocked`,
    priceRange,
    candidates: [],
    evidence: [bundle.futureClassOpportunity.reason],
    boundary: bundle.futureClassOpportunity.boundary,
  }
  return {
    asset,
    status: 'future-class-unavailable',
    title: `No same-horizon ${year} class artifact`,
    priceRange,
    candidates: [],
    evidence: ['No pipeline-derived player ranking is available at the required time horizon.'],
    boundary: ['Use the current provider range and roster-specific original-owner outlook; do not invent prospect strength.'],
  }
}
