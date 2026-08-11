# Fixed league context

RosterLab supports exactly two private Sleeper leagues:

| UI label | Sleeper league ID | Current distinguishing rules |
| --- | --- | --- |
| BC League | `1336087922847289344` | 0.75 TEP, 10 bench, 2 taxi, 3 rookie rounds |
| Emperor Phil | `1312112570039037952` | 0.5 TEP, K/DST, 14 bench, 4 taxi, 2 reserve, 4 rookie rounds |

Both are currently 12-team superflex, full-PPR dynasty leagues. The app reads
the exact settings from Sleeper on every load and constructs one
`LeagueContext`. The fixed IDs are an allowlist, not a general league registry.
The UI does not accept arbitrary league IDs.

## Where context applies

- Team construction, legal-lineup optimization, draft-pick ownership, and the
  number of rookie rounds use the live Sleeper league settings.
- The production model remains trained and audited against generic PPR points
  per NFL team week. The output layer adds the active league's exact TE premium
  using observed receptions per team week. This deterministic adjustment is
  visible and is not described as a separately trained league model.
- Trade Lab and league rankings consume those adjusted player projections and
  the actual league starting slots. K and DST are retained as roster assets but
  remain outside the skill-position production model.
- Market tape, offer outcomes, journal records, research state, and alerts are
  already isolated by authenticated user and league ID. New market snapshots
  also record a settings fingerprint. Labels never cross fingerprints if a
  league changes settings.
- Rookie forecasts remain position-relative generic-PPR production evidence.
  Draft depth and taxi capacity are shown as league context, but the forecast
  is not rescaled without a validated target that supports doing so.

## Imported provider boundary

Tradyr accepts team count and quarterback format, but its player request only
distinguishes TEP on or off. Both private leagues therefore use the same broad
superflex TEP+ provider bucket even though Sleeper has exact 0.5 and 0.75
premiums. RosterLab exposes that limitation in Rankings, Trade Lab, Journal,
Evidence, Rookie Board, and Model views. It does not manufacture an exact price
conversion.

## Adding another league later

Adding a league is a code change. It requires a new fixed ID and label, fixture
coverage for its scoring/roster rules, confirmation that the projection output
layer supports any scoring difference, and an explicit provider-format note.
Only then should it be added to the switcher.
