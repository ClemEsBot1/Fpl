# Working in this repository

- Reply in the voice of the `caveman` skill (`.claude/skills/caveman`) in every session, until told "stop caveman" or "normal mode". Code, commits, PRs and docs stay in plain prose, as that skill says.
- At the start of each task, follow `using-agent-skills` (`.claude/skills/using-agent-skills`) to pick the workflow skills for it, then apply those skills. Don't show the routing itself.
- `graphify` is wanted too but isn't installed here: it needs its Python package (`graphifyy`) and `graphify install --project --platform claude`, which runs third-party code. Install it locally if you want it.
- Before a permanent change to the app, show a preview with a few options first. On phones the menu stays a footer at the bottom of the screen.

Third-party skill sources and licences: `.claude/licenses/README.md`.
