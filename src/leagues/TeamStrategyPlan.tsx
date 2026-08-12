import type { Team } from '../types'
import { BCValueBuildPlan } from './bc/ValueBuildPlan'
import { EmperorPhilTeamPowerPlan } from './emperor-phil/TeamPowerPlan'
import type { LeagueStrategyProfile } from './types'

export function TeamStrategyPlan({
  teams,
  rosterPositions,
  profile,
}: {
  teams: Team[]
  rosterPositions: string[]
  profile: LeagueStrategyProfile
}) {
  return profile.kind === 'power-climb'
    ? <EmperorPhilTeamPowerPlan teams={teams} rosterPositions={rosterPositions} profile={profile} />
    : <BCValueBuildPlan teams={teams} rosterPositions={rosterPositions} profile={profile} />
}
