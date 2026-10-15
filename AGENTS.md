# ROMinit — agent notes

## Vault

- Hub: `~/Documents/Vault/wiki/projects/Hardware/ROMinit.md`
- Tasks: `~/Documents/Vault/wiki/tasks/ROMinit.md`
- Log: `~/Documents/Vault/wiki/logs/ROMinit - Execution Log.md`

Log work there. Never wipe the Mi A3 for tests; nothing audible on owner devices without asking (bench sound is opt-in, `ROMINIT_SOUND=1`).

## Keep it agent-ready (AI flashing comes later)

A future CLI/MCP will run the same flashes as the site (Vault task `rominit-cli-spike`). Keep that possible:

- Flash logic lives in `src/` (catalog, recipes, protocols) and gets its USB/storage objects passed in. Only `src/protocols/usb.js` (device picking) and the OPFS use in `src/recipes/fastboot-tgz.js` touch browser APIs; don't add more. `site/` is UI only.
- Everything a flash needs is catalog data: files pinned by SHA-256, steps from recipe verbs, `confirm`, `warning`, `requirements`. No flash knowledge hard-coded in `site/app.js`.
- Destructive stages keep a typed `confirm` phrase; an agent must get it from the human, never supply it.
