# RosterLab

RosterLab is a browser-based dynasty fantasy football dashboard for Sleeper leagues. It imports public league data, builds league-relative power rankings, resolves current draft-pick ownership, and evaluates proposed trades with consensus market values.

The default league is `1336087922847289344`, but any public Sleeper NFL league ID can be entered in the header.

## Data sources

- [Sleeper's public API](https://docs.sleeper.com/) supplies league settings, managers, rosters, draft order, and traded picks.
- [Tradyr's public API](https://api.tradyr.app/docs) supplies permitted, attributed composite dynasty values derived from KeepTradeCut and FantasyCalc. KeepTradeCut is not scraped.

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

All displayed scores are relative to the imported league, from 0–100. Future picks without a known draft slot use the market value of the middle pick in their round. The trade evaluator discounts extra package pieces and adds a small premium for elite assets; its output is a market check, not a projection or guarantee.
