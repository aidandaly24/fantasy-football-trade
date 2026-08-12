import type { Asset, NewsArticle } from './types'

export type TradeDecisionStatus = 'researching' | 'offered' | 'countered' | 'accepted' | 'rejected' | 'withdrawn'

export type TradeDecisionAsset = Pick<Asset, 'id' | 'name' | 'kind' | 'position' | 'value'>

export type TradeDecisionSnapshot = {
  capturedAt: string
  marketNetToMe: number
  currentSeasonPowerDelta: number | null
  lineupPpgDelta: number | null
  providerNetToMe: { ktc: number | null; fantasycalc: number | null }
  pickValueNetToMe: number
  expectedPnl30: number | null
  trackedAssetLowerPnl30: number | null
  returnCoverage: number | null
  strategy: { mode: string; horizonYears: number }
  evidenceVersions: {
    market: string
    assetReturn: string | null
    eventModel: string | null
  }
}

export type TradeDecisionCatalyst = Pick<NewsArticle, 'id' | 'title' | 'url' | 'source' | 'publishedAt' | 'eventType' | 'eventDirection'> & {
  playerId: string
  playerName: string
}

export type TradeDecisionDraft = {
  leagueId: string
  status: TradeDecisionStatus
  myRosterId: number
  counterpartRosterId: number
  send: TradeDecisionAsset[]
  receive: TradeDecisionAsset[]
  snapshot: TradeDecisionSnapshot
  thesis: string
  holdPeriod: string
  exitCondition: string
  catalysts: TradeDecisionCatalyst[]
}

export type TradeDecision = TradeDecisionDraft & {
  id: string
  createdAt: string
  updatedAt: string
  offeredAt: string | null
  resolvedAt: string | null
}

export type TradeDecisionBundle = {
  decisions: TradeDecision[]
}

export function toDecisionAsset(asset: Asset): TradeDecisionAsset {
  return { id: asset.id, name: asset.name, kind: asset.kind, position: asset.position, value: asset.value }
}
