# Changelog

## 0.1.2 — 2026-10-12

- The delivery contract is read from the session log instead of a variable that could drift, and cached by the branch tip so a read costs nothing until a new entry arrives.
- Each delivery action is a pure step that returns the next state and its message. Tool names, descriptions and parameters are unchanged.
- Tests run with temporary Pi and prjct folders.

## 0.1.1 — 2026-10-06

- Publish from an independent repository with its own checks, lockfile and declared npm dependencies. Preserve the extension history and install name.
