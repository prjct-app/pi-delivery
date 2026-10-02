# pi-delivery

[![pi-delivery — for PI Agent](https://raw.githubusercontent.com/prjct-app/pi-local-extensions/main/pi-delivery/docs/cover-v2.png)](https://pi.dev)

Track acceptance criteria, evidence, reviews, and unresolved risks before completing a substantial Pi task. New edits make earlier evidence stale.

## Install

Requires Pi and Node.js 22.19+. Install the package, then reload Pi:

```sh
pi install npm:@prjct.app/pi-delivery
```

## Use

The controller starts inactive. The agent calls `delivery_start` with a goal, criteria, and risk level, then uses `delivery` to record evidence, reviews, risks, and completion. It is intended for substantial or risky work, not every short answer.

- `/delivery-status` shows the current assessment and remaining blockers.
- `/delivery-reset` clears the active delivery.
- Completion requires passing evidence for every criterion and the reviews required by the risk level. Unresolved risks or stale evidence block it.

State belongs to the Pi session. The controller checks recorded evidence; it does not run tests or independently certify their results.

## Development

From the repository root:

```sh
node scripts/build-pi.mjs pi-delivery
```

Run `npm test` in this package. License: [MIT](LICENSE).
