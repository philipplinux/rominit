# ROM notes (not published)

One Markdown file per ROM: `catalog/notes/<codename>/<rom-id>.md`. The build ignores this folder, so nothing here reaches the site (yet). Agents read it before scraping, updating or flashing that ROM.

```markdown
# <ROM name> <version> · <codename>

## Status
- Agent-flashed: never | yes, <date>, run/commit <ref>, phone <model> (last successful end-to-end flash by an agent)

## Best path
1. The order that actually worked, from a clean phone to booted ROM (stages, modes, choices like slot or gapps), with the run it was proven in.

## Pitfalls
- Short, sourced facts that bite: wrong firmware base, slot traps, gapps order, bootloops and the fix. URL or "seen in run <code>" for each.

## Agent diary
- 2026-10-16 · <agent/harness> · what was tried · outcome · link/commit
```

Newest diary line last. Facts that the site needs go into the ROM JSON (`requirements`, `warning`, `notes`), not here.
