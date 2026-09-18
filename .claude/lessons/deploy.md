# Deploying

**A dropped push and a slow build look identical. Check `total_count`,
never `state` alone.**

GitHub reports `state: "pending"` for a commit that has **no checks at
all**. That is indistinguishable at a glance from a build in progress, so
a push Vercel never received reads as "still building" forever. On
2026-09-19 this cost about 40 minutes of polling before anyone read
`total_count` and saw `0` (commit `c4d7b70`).

Use the script, which encodes the distinction:

```
npm run deploy:status          # HEAD
npm run deploy:status -- <sha>
npm run deploy:wait            # poll until it settles
```

Exit codes: `0` deployed, `1` build failed, `2` never received, `3` still
building.

On `2`, re-trigger with `git commit --allow-empty` and push. Waiting will
not help. That fixed it the one time it has happened.

Builds that do start have taken anywhere from one to twenty-plus minutes,
so slowness on its own is not evidence of a drop.

## Context

- Push to `main` deploys via Vercel's GitHub integration. Production
  alias is https://yuzu-block.vercel.app.
- The per-deployment URL sits behind deployment protection and needs a
  login. Verify on the alias.
- The Vercel MCP tools **cannot see this project**: `list_projects`
  returns only `yuzu-site` and `yuzu-app`, `get_project` 404s by id and
  by slug, yet `create_git_project` refuses with 409 "already exists".
  Do not conclude the project is missing, and never deploy into
  `yuzu-site` or `yuzu-app` — those are different live sites.
- `.vercel/project.json` points at a stale project id. Ignore it.
