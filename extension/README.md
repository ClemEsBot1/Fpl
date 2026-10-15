# FPL Checker browser extension

Shows FPL Checker's predicted points on the official FPL site
(fantasy.premierleague.com):

- a small badge with next gameweek's predicted points after every player
  name it can match (amber when FPL flags him as doubtful);
- a panel, bottom right, with the squad on show (yours when logged in to
  FPL, or the team in the address), its predicted XI score with the captain
  counted twice, and the best captain;
- a toolbar popup with the top captains, a player search and switches for
  the badges and the panel.

Predictions come from `https://fplchecker.co.uk/ext/predictions.json`
(`api/optimal-squad.js?page=ext`, built by `src/lib/extensionFeed.js`),
kept for 30 minutes by `background.js`. The squad is read from FPL's own
API in the browser (`/api/me/`, `/api/my-team/<id>/`, or a team's public
picks) and never leaves it.

`lib.js` holds the logic and is tested in `test/extension.test.js`.
Icons are drawn from `public/icons/icon.svg` by
`node scripts/make-extension-icons.mjs`.

## Try it locally

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick this `extension/` folder.
3. Open https://fantasy.premierleague.com and log in.

## Publish or update on the Chrome Web Store

1. Bump `version` in `manifest.json` (every upload needs a higher one).
2. Merge to main. The **Browser extension** workflow packs the zip: open
   the run in GitHub Actions and download it under **Artifacts** (GitHub
   wraps it in another zip; upload the inner `fpl-checker-extension-x.y.z.zip`).
3. In the Chrome Web Store developer dashboard
   (https://chrome.google.com/webstore/devconsole, one-off $5 sign-up),
   **New item** (or **Package > Upload new package** for an update).
4. Once approved, put the listing's address in `EXTENSION_STORE_URL`
   (`src/lib/seoPage.js`) and run `node scripts/make-seo-pages.mjs`, so
   /fpl-chrome-extension links to it.

The same zip works for Microsoft Edge Add-ons.

### Listing

- **Name**: FPL Checker: Predicted Points for FPL
- **Summary**: from `manifest.json` `description`.
- **Category**: Sports (or Fun).
- **Language**: English (UK).
- **Homepage**: https://fplchecker.co.uk/fpl-chrome-extension
- **Privacy policy**: https://fplchecker.co.uk/fpl-chrome-extension#privacy
- **Description**:

  > See predicted points for every Fantasy Premier League player, right on
  > the official FPL site.
  >
  > FPL Checker predicts every player's points for the coming gameweek and
  > the four after it, from fixtures, minutes, form, betting odds and injury
  > news, with a machine-learning model trained on every gameweek since 2020.
  >
  > With this extension:
  > • a predicted-points badge sits next to each player's name on Pick Team,
  >   Transfers, Points and the stats pages;
  > • a panel shows your team's predicted score, captain counted twice;
  > • it tells you your best captain, and what switching the armband adds;
  > • doubtful players turn amber, with FPL's injury news on hover;
  > • the toolbar button lists this week's top captains and finds any player.
  >
  > Free, no account, no ads, no tracking. It never asks for your FPL
  > password and can't change your team. For transfer plans, chips and
  > mini-league views, open your full check at fplchecker.co.uk.
  >
  > Not affiliated with the Premier League or Fantasy Premier League.

- **Screenshots** (1280×800 or 640×400, at least one): the FPL Pick Team page
  with badges and the panel open; the Transfers list with badges; the popup.
- **Small promo tile** (440×280): optional.

### Privacy tab answers

- **Single purpose**: show FPL Checker's predicted Fantasy Premier League
  points on the official FPL website.
- **storage**: keeps the downloaded predictions (30 minutes) and the user's
  two display settings on their device.
- **Host permission, fplchecker.co.uk**: downloads the predictions file.
  The content script on fantasy.premierleague.com adds the badges and the
  panel to the FPL site.
- **Remote code**: No. All code is in the package; only JSON data is fetched.
- **Data usage**: tick nothing collected. The squad is read in the browser
  to show its predictions and never sent anywhere. Certify the three
  disclosures (not sold, not used for unrelated purposes, not used for
  credit).
