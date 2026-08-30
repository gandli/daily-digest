# Contributing

## PR workflow

1. Branch from `main` — `git checkout -b feat/your-change`
2. Make changes, add tests, verify with `npm run typecheck && npm test`
3. Push and open a PR against `main`
4. Squash merge when CI passes

## Code style

- `tsc --strict` catches everything — no additional linter
- `ponytail:` comments mark deliberate simplifications with a ceiling
- Tests required for new logic; trivial one-liners exempt

## Commit messages

Conventional Commits: `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`