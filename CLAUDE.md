## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Always pass `--budget 5000` to `query` (graphify's own default of 2000 tokens cuts most answers short). Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Answered report questions are saved in graphify-out/memory/ (committed). Before working on one of GRAPH_REPORT.md's "Suggested Questions", check there for a saved answer; after answering a new one, save it with `graphify save-result --question "..." --answer "..." --outcome useful --nodes <labels>`. The list always shows 7 questions, so a new one appearing doesn't mean the old ones came back.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Use the graph, not memory, for codebase questions. Hooks in .claude/settings.json rebuild it at session start and after each reply.
