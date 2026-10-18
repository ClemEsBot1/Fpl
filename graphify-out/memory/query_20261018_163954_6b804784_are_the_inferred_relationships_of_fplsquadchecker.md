---
type: "query"
date: "2026-10-18T16:39:54.355032+00:00"
question: "Are the inferred relationships of FPLSquadChecker() with handleStartCustomBuild() and readCompareIds() correct?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["FPLSquadChecker()", "handleStartCustomBuild()", "readCompareIds()"]
---

# Q: Are the inferred relationships of FPLSquadChecker() with handleStartCustomBuild() and readCompareIds() correct?

## Answer

Yes, all correct: readCompareIds is the useState initialiser (App.jsx), handleStartCustomBuild is the Build a squad menu item's run callback, buildResultsData was passed to useHomeTeam (now lives in useResults). Inferred only because they are passed, not called. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- FPLSquadChecker()
- handleStartCustomBuild()
- readCompareIds()