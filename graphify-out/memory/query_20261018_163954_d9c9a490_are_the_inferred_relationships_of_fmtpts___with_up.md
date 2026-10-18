---
type: "query"
date: "2026-10-18T16:39:54.837016+00:00"
question: "Are the inferred relationships of fmtPts() with upcomingPanels() and ToolScreens.jsx correct?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["fmtPts()", "upcomingPanels()", "ToolScreens.jsx"]
---

# Q: Are the inferred relationships of fmtPts() with upcomingPanels() and ToolScreens.jsx correct?

## Answer

Yes: fmtPts is passed as a formatter (TransferTrends.jsx pointsPanel, ToolScreens.jsx column fmt), so the edges are inferred but real. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- fmtPts()
- upcomingPanels()
- ToolScreens.jsx