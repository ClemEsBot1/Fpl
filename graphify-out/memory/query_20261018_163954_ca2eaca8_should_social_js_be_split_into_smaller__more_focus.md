---
type: "query"
date: "2026-10-18T16:39:54.991020+00:00"
question: "Should social.js be split into smaller, more focused modules?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["social.js", "bluesky.js", "socialSent.js"]
---

# Q: Should social.js be split into smaller, more focused modules?

## Answer

Done: social.js now holds only the post texts and timing; Bluesky posting is src/lib/bluesky.js and the Redis sent-tracking is src/lib/socialSent.js, with tests split to match. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- social.js
- bluesky.js
- socialSent.js