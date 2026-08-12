import type { Asset } from '../types'
import type { LeagueStrategyProfile, ProtectedAssetPolicy } from './types'

export type LeagueTradePolicyFacts = {
  marketNetToMe: number
  currentSeasonPowerDelta: number | null
  outgoing: Asset[]
  incoming: Asset[]
}

export type LeagueTradePolicyDecision = {
  status: 'pass' | 'review' | 'block'
  title: string
  summary: string
  reasons: string[]
}

function matchesProtectedAsset(asset: Asset, policy: ProtectedAssetPolicy): boolean {
  return asset.kind === 'pick'
    && Number(asset.year) === policy.year
    && asset.round === policy.round
    && (policy.slot === undefined || asset.slot === policy.slot)
}

function exposedProtectedAssets(
  policies: ProtectedAssetPolicy[],
  outgoing: Asset[],
  incoming: Asset[],
): string[] {
  return policies.flatMap((policy) => {
    const sent = outgoing.filter((asset) => matchesProtectedAsset(asset, policy)).length
    const received = incoming.filter((asset) => matchesProtectedAsset(asset, policy)).length
    return sent > received ? [policy.label] : []
  })
}

function roleNeedsVerification(asset: Asset): boolean {
  if (asset.kind !== 'player') return false
  if (asset.active === false) return true
  if (asset.depthChartOrder !== null && asset.depthChartOrder !== undefined && asset.depthChartOrder > 1) return true
  return asset.nflStatus !== null && asset.nflStatus !== undefined && asset.nflStatus.toLowerCase() !== 'active'
}

/** Applies only declared league policy to already-computed evidence. It never
 * reprices an asset or blends the evidence lanes into a hidden score. */
export function evaluateLeagueTradePolicy(
  profile: LeagueStrategyProfile,
  facts: LeagueTradePolicyFacts,
): LeagueTradePolicyDecision {
  if (profile.kind === 'power-climb') {
    if (facts.currentSeasonPowerDelta === null) {
      return {
        status: 'review',
        title: 'Power evidence guarded',
        summary: 'The legal lineup is not fully covered, so the private power gate cannot be evaluated.',
        reasons: ['Wait for complete current-season coverage; dynasty value is not a substitute.'],
      }
    }
    if (facts.currentSeasonPowerDelta < profile.minimumMeaningfulPowerGain) {
      return {
        status: 'block',
        title: 'Below the power gate',
        summary: `${facts.currentSeasonPowerDelta >= 0 ? '+' : ''}${facts.currentSeasonPowerDelta} power does not clear the declared +${profile.minimumMeaningfulPowerGain} minimum.`,
        reasons: ['Hold rather than manufacture a depth trade that misses the stated objective.'],
      }
    }
    return {
      status: 'pass',
      title: facts.currentSeasonPowerDelta >= profile.idealPowerGain ? 'Ideal power gate cleared' : 'Power gate cleared',
      summary: `The package adds +${facts.currentSeasonPowerDelta} current-season lineup power.`,
      reasons: facts.currentSeasonPowerDelta >= profile.idealPowerGain
        ? [`It clears the +${profile.idealPowerGain} ideal threshold.`]
        : [`It clears the minimum but remains below the +${profile.idealPowerGain} ideal threshold.`],
    }
  }

  const outgoingPickValue = facts.outgoing
    .filter((asset) => asset.kind === 'pick')
    .reduce((sum, asset) => sum + asset.value, 0)
  const incomingPickValue = facts.incoming
    .filter((asset) => asset.kind === 'pick')
    .reduce((sum, asset) => sum + asset.value, 0)
  const draftCapitalNetToMe = incomingPickValue - outgoingPickValue
  const tripleLoss = profile.tradeGuard.rejectTripleLoss
    && facts.marketNetToMe < 0
    && facts.currentSeasonPowerDelta !== null
    && facts.currentSeasonPowerDelta < 0
    && draftCapitalNetToMe < 0
  if (tripleLoss) {
    return {
      status: 'block',
      title: 'BC triple-loss guard triggered',
      summary: 'The package loses current market value, current-season lineup power, and draft capital at the same time.',
      reasons: [
        `${Math.abs(facts.marketNetToMe).toLocaleString()} less current market value comes back.`,
        `${Math.abs(facts.currentSeasonPowerDelta ?? 0).toLocaleString()} current-season power is lost.`,
        `${Math.abs(draftCapitalNetToMe).toLocaleString()} more current pick value is sent than received.`,
      ],
    }
  }

  const reasons: string[] = []
  const exposed = exposedProtectedAssets(profile.protectedAssets, facts.outgoing, facts.incoming)
  if (exposed.length) reasons.push(`Protected liquidity leaves without a same-class replacement: ${exposed.join(', ')}.`)
  if (profile.tradeGuard.reviewMarketLoss && facts.marketNetToMe < 0) {
    reasons.push(`${Math.abs(facts.marketNetToMe).toLocaleString()} more current market value is sent than received.`)
  }
  if (facts.currentSeasonPowerDelta === null) reasons.push('Current-season lineup power is not fully covered.')
  else if (facts.currentSeasonPowerDelta < 0) reasons.push(`${Math.abs(facts.currentSeasonPowerDelta).toLocaleString()} current-season lineup power is lost.`)
  if (
    profile.tradeGuard.verifyRoleWhenPayingPremium
    && facts.marketNetToMe < 0
    && facts.incoming.some(roleNeedsVerification)
  ) reasons.push('An incoming player has a non-starting or inactive role marker; verify the live role before paying the premium.')

  if (reasons.length) {
    return {
      status: 'review',
      title: 'BC value-build review',
      summary: 'The trade avoids the hard triple-loss veto but spends value or certainty that the current phase is designed to preserve.',
      reasons,
    }
  }
  return {
    status: 'pass',
    title: 'BC value-build gate cleared',
    summary: 'The package avoids a current-market loss, a current-power loss, and a net protected-pick loss.',
    reasons: ['Market value, lineup power, draft liquidity, and role evidence remain separate and inspectable.'],
  }
}
