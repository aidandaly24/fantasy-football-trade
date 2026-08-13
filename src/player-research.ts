import { isSupportedLeagueId } from './league-context'
import type { Asset, PlayerProjection, Team } from './types'

export type PlayerAddress = {
  leagueId: string
  playerId: string
}

export type PlayerResearchProfile = {
  asset: Asset
  owner: Team
  myTeam: Team
  isMyRoster: boolean
  rosterStatus: 'Starter' | 'Taxi' | 'Reserve' | 'Bench'
  modeledLineupStatus: 'Modeled starter' | 'Modeled bench'
  positionDepth: Asset[]
  projection: PlayerProjection | null
  marketAsOf: string
}

export function parsePlayerAddress(search: string): PlayerAddress | null {
  const query = new URLSearchParams(search)
  const leagueId = query.get('league')
  const playerId = query.get('player')?.trim()
  if (!isSupportedLeagueId(leagueId) || !playerId || playerId.length > 80) return null
  return { leagueId, playerId }
}

export function playerAddress(search: string, leagueId: string, playerId: string | null): string {
  const query = new URLSearchParams(search)
  query.set('league', leagueId)
  if (playerId) query.set('player', playerId)
  else query.delete('player')
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export function buildPlayerResearchProfile(input: {
  playerId: string
  teams: Team[]
  myRosterId: number
  projection?: PlayerProjection
  marketAsOf: string
}): PlayerResearchProfile | null {
  const owner = input.teams.find((team) => team.players.some((player) => player.id === input.playerId))
  if (!owner) return null
  const asset = owner.players.find((player) => player.id === input.playerId)
  const myTeam = input.teams.find((team) => team.rosterId === input.myRosterId)
  if (!asset || asset.kind !== 'player' || !myTeam) return null
  const rosterStatus = asset.isTaxi
    ? 'Taxi'
    : asset.isReserve
      ? 'Reserve'
      : asset.isStarter
        ? 'Starter'
        : 'Bench'
  return {
    asset,
    owner,
    myTeam,
    isMyRoster: owner.rosterId === myTeam.rosterId,
    rosterStatus,
    modeledLineupStatus: owner.optimizedStarters.some((player) => player.id === asset.id)
      ? 'Modeled starter'
      : 'Modeled bench',
    positionDepth: owner.players
      .filter((player) => player.position === asset.position)
      .sort((left, right) => right.value - left.value),
    projection: input.projection && input.projection.gamesObserved > 0 ? input.projection : null,
    marketAsOf: input.marketAsOf,
  }
}
