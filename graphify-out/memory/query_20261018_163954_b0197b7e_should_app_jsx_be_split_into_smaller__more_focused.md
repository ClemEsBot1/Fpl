---
type: "query"
date: "2026-10-18T16:39:54.581615+00:00"
question: "Should App.jsx be split into smaller, more focused modules?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["App.jsx", "FPLSquadChecker()"]
---

# Q: Should App.jsx be split into smaller, more focused modules?

## Answer

Done: PR #85 moved state into src/hooks (useStage, useAccount, useFplData, useHomeTeam, useRecap, useReviewSlots), components and lib helpers (2190 -> 1050 lines); this branch adds useResults (-> ~950 lines). What remains is the screen handlers, menu and layout; further splits have low payoff. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- App.jsx
- FPLSquadChecker()