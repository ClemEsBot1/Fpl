---
type: "query"
date: "2026-10-18T16:39:54.471108+00:00"
question: "What connects $schema, plugins, browser to the rest of the system?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["$schema", "plugins", "browser", ".oxlintrc.json"]
---

# Q: What connects $schema, plugins, browser to the rest of the system?

## Answer

Nothing, by design: they are keys in .oxlintrc.json (lint config). Config files import nothing, so their nodes are isolated. Not a documentation gap. Checked 2026-10-18.

## Outcome

- Signal: useful

## Source Nodes

- $schema
- plugins
- browser
- .oxlintrc.json