## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, use the Graphify MCP tools first (`list_repositories`, `query_graph`, `graphify_find`, `graphify_callers` / `graphify_callees`, `graphify_impact`, `graphify_tests_for`, `graphify_file_neighbors`; load them with ToolSearch if they are deferred). Fall back to the CLI only when the MCP server isn't connected or the question needs uncommitted changes (the MCP index is the pushed snapshot of main).
- CLI fallback: run `graphify query "<question>"` when graphify-out/graph.json exists. Always pass `--budget 5000` to `query` (graphify's own default of 2000 tokens cuts most answers short). Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Answered report questions are saved in graphify-out/memory/ (committed). Before working on one of GRAPH_REPORT.md's "Suggested Questions", check there for a saved answer; after answering a new one, save it with `graphify save-result --question "..." --answer "..." --outcome useful --nodes <labels>`. The list always shows 7 questions, so a new one appearing doesn't mean the old ones came back.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Use the graph, not memory, for codebase questions. Hooks in .claude/settings.json rebuild it at session start and after each reply.
## Pull requests

- Merge your own PRs yourself: once CI is green on the latest commit, there is no merge conflict and no review comment is left unanswered, squash-merge it without waiting to be asked.
## Bugs

- When you find a bug while working on something else, fix it in the same PR (with a test that fails without the fix) instead of only reporting it or asking first. Say in the PR what it was.

## Suggesting features

- Before suggesting any feature or improvement, check the code for it first: run a targeted Graphify MCP `query_graph` (or `graphify_find`) for each idea, or the CLI `graphify query "<feature>" --budget 5000` if MCP isn't connected, and open the files it points to. Don't build the list from file names, the welcome page or memory.
- Only suggest what isn't there. If something exists in part, say so and name the file, and suggest the missing piece instead (e.g. "price forecast exists in src/lib/priceForecast.js; missing: X").
- Don't suggest having native speakers review the translations.

## Always

- Always use the /caveman skill, on every message, whatever the task and whether or not it is coding. Reply in the caveman skill's voice until told "stop caveman" or "normal mode".

## Claude settings instructions

- Always use the /graphify and /using-agent-skills skills.
- Start with using-agent-skills, but never show its output. Silently apply the skills it picks.
- Use graphify for questions about the codebase (Graphify MCP first, CLI as fallback).
- If making or editing a website: also use the skills from the emilkowalski/skills repo (Skills For Designers and Engineers) and /ui-ux-pro-max.
- For cybersecurity requests, use skills from the Masriyan/Claude-Code-CyberSecurity-Skill repo.

<!-- graphify-rules-start (managed by `graphify init`) -->
## Use Graphify before grep

This repository is indexed by Graphify: a code graph over its call, dependency, and test structure, exposed through a connected Graphify MCP server. Before reaching for grep or reading files, use the Graphify tools your MCP client lists (their exact names and descriptions are in the server's tool list) for what the graph knows and a text search does not:

- find where a symbol, function, or class is defined (instead of grepping for it)
- understand how something works, or where a behavior is handled
- find who calls a function, or what it calls
- see what a change affects (its blast radius) and which tests cover it
- map a file's dependencies and dependents

Fall back to grep or file reads only for what the graph does not model: literal string or comment matches, non-indexed files, or reading a file you have already located. If no Graphify tools are listed, check the MCP server connection.
<!-- graphify-rules-end -->
