# RosterLab

RosterLab is a private dynasty fantasy football research desk for Sleeper leagues. It imports league data, builds league-relative power rankings, resolves current draft-pick ownership, evaluates proposed trades, and scans the entire league for value, lineup, and news-driven trade opportunities.

The default league is `1336087922847289344`, but any public Sleeper NFL league ID can be entered in the header.

## Data sources

- [Sleeper's public API](https://docs.sleeper.com/) supplies league settings, managers, rosters, draft order, and traded picks.
- [Tradyr's public API](https://api.tradyr.app/docs) supplies permitted, attributed composite dynasty values derived from KeepTradeCut and FantasyCalc. KeepTradeCut is not scraped.
- Linked NFL reporting and Sleeper add/drop velocity supply advisory catalysts. Sources are deduplicated, classified, and saved only after a confident player match.

## Private trade hunter

- Recent completed trades and current roster shape infer whether each manager is contending, retooling, or rebuilding. Private manual overrides take precedence.
- Team direction changes the probability distribution and value of unresolved future picks.
- The Edge Board separates projected market movement, starting-lineup impact, catalyst strength, seller fit, confidence, and acquisition limits instead of compressing everything into one letter grade.
- Generated packages have opening, target, counter, and walk-away stages. Logged offers and daily recommendation snapshots are isolated by authenticated user and league.
- Completed trades and saved recommendations are evaluated at 7/30/90/180-day checkpoints so the research process can be measured against its entry assumptions.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Verify

```bash
npm test
npm run build
```

## Ranking model

- **Contender** emphasizes the best legal lineup for the league's actual roster slots, then playable depth.
- **Future** emphasizes the most valuable dynasty core and owned rookie picks.
- **Overall** balances lineup, core, depth, and capital.

All displayed roster scores are relative to the imported league, from 0–100. Future picks without a known slot use a direction-weighted early/mid/late distribution, with a visible manual override for private league knowledge. The trade evaluator discounts extra package pieces and adds a small premium for elite assets; its output is a market check, not a projection or guarantee.
