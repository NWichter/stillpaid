# Contributing

Issues and pull requests are welcome.

1. Follow "Run it locally" in the README: build in the pinned Anchor Docker image, start the local validator with the feature flag, deploy.
2. Program changes need a test in `tests/program.test.ts`; `npm test` must pass (it runs in CI).
3. App changes: `npm run typecheck`, then `npm run app:smoke` against a running app.
4. Keep comments for what is not obvious from the code.

By contributing you agree that your work is licensed under the Apache License 2.0.
