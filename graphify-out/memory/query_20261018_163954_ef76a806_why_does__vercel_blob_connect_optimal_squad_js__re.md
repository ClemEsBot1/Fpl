---
type: "query"
date: "2026-10-18T16:39:54.716116+00:00"
question: "Why does @vercel/blob connect optimal-squad.js, refresh-optimal.js, digestHandler.js, adminServer.js and the scripts?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["@vercel/blob", "optimal-squad.js", "refresh-optimal.js"]
---

# Q: Why does @vercel/blob connect optimal-squad.js, refresh-optimal.js, digestHandler.js, adminServer.js and the scripts?

## Answer

Expected: about 10 files (api odds, screenshot-report, player-history, accuracy, refresh-optimal, optimal-squad; adminServer.js, digestHandler.js; 2 scripts) each use Blob storage directly. A shared wrapper is only worth it if their read/write code repeats; nothing to fix now. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- @vercel/blob
- optimal-squad.js
- refresh-optimal.js