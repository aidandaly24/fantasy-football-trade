import { ChevronRight, Sparkles, Target, TrendingUp, Trophy } from 'lucide-react'
import { useMemo } from 'react'
import type { LeagueContext } from '../league-context'
import { strategyProfileForLeague } from '../leagues'
import { TeamStrategyPlan } from '../leagues/TeamStrategyPlan'
import { buildTeamRankComparisons } from '../rank-comparison'
import type { TeamRankComparison } from '../rank-comparison'
import { rosterProfile } from '../rankings'
import type { RankingMode, Team } from '../types'
import { AssetBadge, Avatar, formatValue, MetricBar } from '../components/domain-ui'

const modeCopy: Record<RankingMode, { label: string; description: string }> = {
  overall: {
    label: 'Current market',
    description: 'The direct sum of current player and pick composite values. No package compression or roster-fit adjustment.',
  },
  contender: {
    label: 'Current-season power',
    description: 'The direct sum of same-format redraft consensus values in each team’s best legal lineup. It is a relative power index, not a points forecast.',
  },
  future: {
    label: 'Draft capital',
    description: 'The direct sum of current provider values for owned picks. Unresolved picks use the provider midpoint and show their full range.',
  },
}

function RankingBoard({
  teams,
  mode,
  comparisons,
  myRosterId,
  onOpenTeam,
}: {
  teams: Team[]
  mode: RankingMode
  comparisons: Map<number, TeamRankComparison>
  myRosterId: number
  onOpenTeam: (id: number) => void
}) {
  return (
    <div className="ranking-board panel">
      <div className="panel-heading ranking-heading">
        <div>
          <span className="eyebrow">League table</span>
          <h2>{modeCopy[mode].label}</h2>
        </div>
        <span className="method-note">Market and power ranks stay visible together</span>
      </div>
      <div className="ranking-list">
        {teams.map((team, index) => {
          const score = team.metrics[mode]
          const comparison = comparisons.get(team.rosterId) ?? {
            marketRank: index + 1,
            powerRank: index + 1,
            powerGap: 0,
          }
          const activeRank = mode === 'overall'
            ? comparison.marketRank
            : mode === 'contender'
              ? comparison.powerRank
              : index + 1
          return (
            <button
              type="button"
              className={`ranking-row ${team.rosterId === myRosterId ? 'selected' : ''}`}
              key={team.rosterId}
              onClick={() => onOpenTeam(team.rosterId)}
              aria-label={`Open ${team.teamName} team page`}
            >
              <span className={`rank-number rank-${activeRank}`}>{activeRank}</span>
              <Avatar team={team} size="sm" />
              <span className="rank-team-copy">
                <strong>{team.teamName}</strong>
                <small>@{team.ownerName}</small>
              </span>
              <span
                className="rank-comparison"
                aria-label={`Market rank ${comparison.marketRank}; current-season power rank ${comparison.powerRank}`}
              >
                <span className={mode === 'overall' ? 'active' : ''}>
                  <small>Market</small>
                  <b>#{comparison.marketRank}</b>
                </span>
                <span className={mode === 'contender' ? 'active' : ''}>
                  <small>Power</small>
                  <b>#{comparison.powerRank}</b>
                </span>
              </span>
              <span className="rank-score-block">
                <span className="rank-score-line">
                  <b>{formatValue(score)}</b>
                  <small>{mode === 'contender' ? 'lineup power' : 'current value'}</small>
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TeamPreview({ team, teams, onOpenPlayer, onOpenTeam }: { team: Team; teams: Team[]; onOpenPlayer: (playerId: string) => void; onOpenTeam: (rosterId: number) => void }) {
  const profile = rosterProfile(team, teams)
  const topPlayers = [...team.players].sort((a, b) => b.value - a.value).slice(0, 5)
  const topPicks = [...team.picks].sort((a, b) => b.value - a.value).slice(0, 3)
  const comparison = buildTeamRankComparisons(teams).get(team.rosterId) ?? {
    marketRank: teams.length,
    powerRank: teams.length,
    powerGap: 0,
  }

  return (
    <aside className="team-scout panel" id="my-team-preview">
      <div className="scout-hero">
        <div className="scout-topline">
          <span className="window-pill"><Sparkles size={14} /> {profile.label}</span>
          <span className="scout-rank-pair">
            <span><small>Market</small><b>#{comparison.marketRank}</b></span>
            <span><small>Power</small><b>#{comparison.powerRank}</b></span>
          </span>
        </div>
        <div className="scout-identity">
          <Avatar team={team} size="lg" />
          <div>
            <h2>{team.teamName}</h2>
            <p>Managed by {team.ownerName}</p>
          </div>
        </div>
        <p className="window-copy">{profile.description}</p>
      </div>

      <div className="scout-section metrics-grid">
        <MetricBar label="Current-season lineup power" value={formatValue(team.metrics.contender)} />
        <MetricBar label="Covered model PPG" value={team.metrics.lineup.toFixed(1)} />
        <MetricBar label="Player market value" value={formatValue(team.metrics.core)} />
        <MetricBar label="Bench market value" value={formatValue(team.metrics.depth)} />
        <MetricBar label="Draft-capital value" value={formatValue(team.metrics.picks)} />
      </div>
      <div className="scout-model-note">
        Current-season power uses the redraft market separately from dynasty value. Covered PPG remains an audited model output and does not control the power rank.
      </div>

      <div className="scout-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">Team preview</span>
            <h3>Top players</h3>
          </div>
          <span className="asset-count">{Math.min(5, team.players.length)} of {team.players.length}</span>
        </div>
        <div className="asset-stack">
          {topPlayers.map((asset, index) => {
            const content = <>
              <span className="asset-index">{index + 1}</span>
              <AssetBadge position={asset.position} />
              <span className="asset-main">
                <strong>{asset.name}</strong>
                <small>
                  {[asset.team, asset.age ? `Age ${asset.age.toFixed(1)}` : null].filter(Boolean).join(' · ')}
                </small>
              </span>
              <b className="asset-value">{formatValue(asset.value)}</b>
              {asset.kind === 'player' && <ChevronRight size={16} aria-hidden="true" />}
            </>
            return <button type="button" className="scout-asset scout-player-link" key={asset.id} onClick={() => onOpenPlayer(asset.id)} aria-label={`Research ${asset.name}`}>{content}</button>
          })}
        </div>
        {topPicks.length > 0 && <>
          <div className="section-title-row scout-pick-heading"><div><h3>Top picks</h3></div><span className="asset-count">{Math.min(3, team.picks.length)} of {team.picks.length}</span></div>
          <div className="asset-stack">
            {topPicks.map((asset, index) => <div className="scout-asset" key={asset.id}>
              <span className="asset-index">{index + 1}</span><AssetBadge position={asset.position} />
              <span className="asset-main"><strong>{asset.name}</strong><small>{asset.slot ? 'Exact draft slot' : `Unresolved midpoint · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)} provider range`}</small></span>
              <b className="asset-value">{formatValue(asset.value)}</b>
            </div>)}
          </div>
        </>}
        <button type="button" className="open-team-button" onClick={() => onOpenTeam(team.rosterId)}>Open full team page <ChevronRight size={16} /></button>
      </div>
    </aside>
  )
}

export function RankingsView({
  teams,
  mode,
  setMode,
  leagueContext,
  myRosterId,
  rosterPositions,
  onOpenPlayer,
  onOpenTeam,
}: {
  teams: Team[]
  mode: RankingMode
  setMode: (mode: RankingMode) => void
  leagueContext: LeagueContext
  myRosterId: number
  rosterPositions: string[]
  onOpenPlayer: (playerId: string) => void
  onOpenTeam: (rosterId: number) => void
}) {
  const sorted = useMemo(
    () => [...teams].sort((a, b) => b.metrics[mode] - a.metrics[mode]),
    [mode, teams],
  )
  const comparisons = useMemo(() => buildTeamRankComparisons(teams), [teams])
  const myTeam = teams.find((team) => team.rosterId === myRosterId) ?? sorted[0]
  const lineupLeader = [...teams].sort((a, b) => b.metrics.contender - a.metrics.contender)[0]
  const coreLeader = [...teams].sort((a, b) => b.metrics.core - a.metrics.core)[0]
  const pickLeader = [...teams].sort((a, b) => b.metrics.picks - a.metrics.picks)[0]
  const strategyProfile = strategyProfileForLeague(leagueContext.id, myRosterId)

  return (
    <main className="page-shell">
      <section className="page-intro">
        <div>
          <span className="eyebrow accent-eyebrow">Home · league overview</span>
          <h1>Compare the league.<br />Without a mystery score.</h1>
          <p>{mode === 'contender' ? `${modeCopy[mode].description} ${leagueContext.labels.projection}.` : modeCopy[mode].description}</p>
          <button type="button" className="browse-players-cta" onClick={() => onOpenTeam(myTeam.rosterId)}>Open my team <ChevronRight size={15} /></button>
        </div>
        <div className="mode-switch" role="group" aria-label="Ranking model">
          {(Object.keys(modeCopy) as RankingMode[]).map((item) => (
            <button
              type="button"
              key={item}
              className={item === mode ? 'active' : ''}
              onClick={() => setMode(item)}
            >
              {modeCopy[item].label}
            </button>
          ))}
        </div>
      </section>

      <div className="league-context-note panel"><span><strong>{leagueContext.label}</strong> · {leagueContext.labels.format}</span><small>{leagueContext.labels.roster}</small></div>
      {strategyProfile && <TeamStrategyPlan teams={teams} rosterPositions={rosterPositions} profile={strategyProfile} />}
      <section className="leader-strip" aria-label="League leaders">
        <div className="leader-card">
          <span className="leader-icon"><Trophy size={19} /></span>
          <span><small>Highest current-season power</small><strong>{lineupLeader.teamName}</strong></span>
          <b>{formatValue(lineupLeader.metrics.contender)}</b>
        </div>
        <div className="leader-card">
          <span className="leader-icon"><TrendingUp size={19} /></span>
          <span><small>Highest player market</small><strong>{coreLeader.teamName}</strong></span>
          <b>{formatValue(coreLeader.metrics.core)}</b>
        </div>
        <div className="leader-card">
          <span className="leader-icon"><Target size={19} /></span>
          <span><small>Most draft capital</small><strong>{pickLeader.teamName}</strong></span>
          <b>{formatValue(pickLeader.metrics.picks)}</b>
        </div>
      </section>

      <section className="rankings-layout">
        <RankingBoard
          teams={sorted}
          mode={mode}
          comparisons={comparisons}
          myRosterId={myTeam.rosterId}
          onOpenTeam={onOpenTeam}
        />
        <TeamPreview team={myTeam} teams={teams} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
      </section>
    </main>
  )
}
