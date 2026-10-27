# Changelog

## Unreleased

- The npm package no longer ships the cover images (1.6 MB → 12.5 kB). The README and Pi gallery load them from GitHub.

## 0.1.3 — 2026-10-26

- Delivery calls and results render as one line: the action with its objective or criterion, then progress, risk and blocker count. Expanding the tool output shows the objective, marked criteria with their latest evidence, risks, review and remaining blockers. The model still receives the full status text.
- The automatic reminder renders the same way, and `/delivery-status` uses the compact view.
- Declares `@earendil-works/pi-tui` as a Pi-provided peer dependency.

## 0.1.2 — 2026-10-12

- The delivery contract is read from the session log instead of a variable that could drift, and cached by the branch tip so a read costs nothing until a new entry arrives.
- Each delivery action is a pure step that returns the next state and its message. Tool names, descriptions and parameters are unchanged.
- Tests run with temporary Pi and prjct folders.

## 0.1.1 — 2026-10-06

- Publish from an independent repository with its own checks, lockfile and declared npm dependencies. Preserve the extension history and install name.
