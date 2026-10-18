---
type: "query"
date: "2026-10-18T16:39:55.137772+00:00"
question: "Should AccountScreens.jsx be split into smaller, more focused modules?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["AccountScreens.jsx", "AuthDialog.jsx", "ProfileScreen.jsx"]
---

# Q: Should AccountScreens.jsx be split into smaller, more focused modules?

## Answer

Done in PR #86: AuthDialog.jsx, MyTeamsScreen.jsx, ProfileScreen.jsx, GoogleMark.jsx and lib/googleEnabled.js; AccountScreens.jsx only re-exports them so they load as one chunk. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- AccountScreens.jsx
- AuthDialog.jsx
- ProfileScreen.jsx