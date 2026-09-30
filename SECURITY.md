# Security

Stillpaid holds client money in program-owned accounts, so security reports are welcome.

## Reporting

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/NWichter/stillpaid/security/advisories/new), not in public issues. You will get an answer within a few days.

## Scope

- The on-chain program `anchor/programs/stillpaid` (devnet `2gbyeNrQm2869HMK2mnSJyHc4cQfDrAGh6dk5ccoVyg4`)
- The web app in `app/`, including the fee sponsor and the crank

## Status

The program has had an internal security review, not an external audit. It runs on devnet with test tokens only. Its upgrade authority is a single key today and moves to a public multisig before mainnet.
