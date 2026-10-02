import assert from "node:assert/strict";
import test from "node:test";
import {
  addCriterion,
  assessCompletion,
  beginDelivery,
  commandMayMutate,
  completeDelivery,
  createDeliveryState,
  normalizeDeliveryState,
  noteMutation,
  recordEvidence,
  recordReview,
  recordRisk,
} from "./state.ts";

test("a low-risk delivery passes with fresh evidence", () => {
  let state = beginDelivery(createDeliveryState(), "Change behavior", ["Tests demonstrate the requested behavior"], "low");
  state = noteMutation(state, "src/example.ts");
  state = recordEvidence(state, "C1", "passed", "Targeted test passed", "npm test", "1 passed");
  const completed = completeDelivery(state);
  assert.equal(completed.assessment.passed, true);
  assert.equal(completed.state.completed, true);
  assert.equal(completed.state.completionRevision, 1);
});

test("pending and failed criteria block completion", () => {
  let pending = beginDelivery(createDeliveryState(), "Implement feature", ["Feature works"], "low");
  assert.match(assessCompletion(pending).blockers.join("\n"), /C1 is pending/);

  pending = recordEvidence(pending, "C1", "failed", "Regression test failed");
  assert.match(assessCompletion(pending).blockers.join("\n"), /C1 failed/);
});

test("a mutation makes earlier evidence and review stale", () => {
  let state = beginDelivery(createDeliveryState(), "Refactor safely", ["Tests pass"], "medium");
  state = recordEvidence(state, "C1", "passed", "Tests passed before edit");
  state = recordReview(state, "passed", "Sanna", "Reviewer found no issues");
  state = noteMutation(state, "src/refactor.ts");
  const blockers = assessCompletion(state).blockers.join("\n");
  assert.match(blockers, /C1 has no evidence after mutation revision 1/);
  assert.match(blockers, /Review predates mutation revision 1/);
});

test("medium and high risk require review, and any failed review blocks", () => {
  let state = beginDelivery(createDeliveryState(), "Change public API", ["Compatibility verified"], "medium");
  state = recordEvidence(state, "C1", "passed", "Compatibility suite passed");
  assert.match(assessCompletion(state).blockers.join("\n"), /requires an independent review/);
  assert.throws(
    () => recordReview(state, "passed", undefined, "Independent reviewer approved the change"),
    /requires a reviewer identifier/,
  );

  state = recordReview(state, "passed", "Sanna", "Independent reviewer approved the change");
  assert.equal(assessCompletion(state).passed, true);

  let low = beginDelivery(createDeliveryState(), "Small change", ["Targeted test passes"], "low");
  low = recordEvidence(low, "C1", "passed", "Targeted test passed");
  low = recordReview(low, "failed", "Ezra", "Reviewer found a regression");
  assert.match(assessCompletion(low).blockers.join("\n"), /Independent review failed/);
});

test("unavailable review needs a rationale and cannot satisfy high-risk work", () => {
  let medium = beginDelivery(createDeliveryState(), "Investigate incident", ["Evidence is documented"], "medium");
  medium = recordEvidence(medium, "C1", "passed", "Evidence log is complete");
  assert.throws(() => recordReview(medium, "unavailable"), /requires a rationale/);
  medium = recordReview(medium, "unavailable", undefined, undefined, "No independent reviewer is configured in this environment");
  assert.equal(assessCompletion(medium).passed, true);

  let high = beginDelivery(createDeliveryState(), "Apply production migration", ["Migration is verified"], "high");
  high = recordEvidence(high, "C1", "passed", "Migration suite passed");
  high = recordReview(high, "unavailable", undefined, undefined, "No reviewer is configured");
  assert.match(assessCompletion(high).blockers.join("\n"), /requires a completed independent review/);
});

test("open blocking risks prevent completion", () => {
  let state = beginDelivery(createDeliveryState(), "Apply migration", ["Migration test passes"], "high");
  state = recordEvidence(state, "C1", "passed", "Migration test passed");
  state = recordReview(state, "passed", "Sanna", "Migration reviewed");
  state = recordRisk(state, {
    description: "Rollback has not been tested",
    level: "high",
    status: "open",
    blocking: true,
  });
  assert.match(assessCompletion(state).blockers.join("\n"), /unresolved blocking risk/);

  state = recordRisk(state, {
    id: "R1",
    description: "Rollback has not been tested",
    level: "high",
    status: "accepted",
    blocking: true,
    rationale: "User explicitly accepted the rollout risk",
  });
  assert.match(assessCompletion(state).blockers.join("\n"), /Review predates contract revision/);
  state = recordReview(state, "passed", "Ezra", "Reviewer approved the accepted rollback risk");
  assert.equal(assessCompletion(state).passed, true);
});

test("automatic mutation stays inactive but is retained if delivery begins later", () => {
  let state = noteMutation(createDeliveryState(), "README.md");
  assert.equal(state.active, false);
  state = { ...state, reminders: 2 };
  state = beginDelivery(state, "Update instructions", ["Instructions are accurate"], "low");
  assert.equal(state.mutationRevision, 1);
  assert.equal(state.reminders, 2);
  assert.deepEqual(state.mutationPaths, ["README.md"]);
  state = noteMutation(state, "README.md");
  assert.equal(state.reminders, 2);
});

test("criterion ids remain stable and increment", () => {
  let state = beginDelivery(createDeliveryState(), "Task", ["First"], "low");
  state = addCriterion(state, "Second");
  assert.deepEqual(state.criteria.map((criterion) => criterion.id), ["C1", "C2"]);
});

test("shell mutation detection is conservative without flagging ordinary verification", () => {
  for (const command of [
    "cat > index.html <<'EOF'\nhello\nEOF",
    "sed -i '' 's/a/b/' file.txt",
    "pnpm add zod",
    "git apply fix.patch",
    "ruff check --fix src",
    "gofmt -w main.go",
    "cargo fmt",
    "printf ok | sudo tee file.txt",
    "Set-Content -Path note.txt -Value ok",
  ]) assert.equal(commandMayMutate(command), true, command);

  for (const command of [
    "npm test",
    "git status --short",
    "rg 'needle' src",
    "python3 -m pytest",
    "cat README.md",
    "npm test >/dev/null 2>&1",
    "command -v tee",
    "gofmt -d main.go",
    "cargo fmt --check",
    "node -e 'console.log(\"a > b\")'",
    "python3 - <<'PY'\nprint('bytes=<missing>')\nPY",
  ]) assert.equal(commandMayMutate(command), false, command);
});

test("restored state discards malformed nested records and recomputes semantic risk", () => {
  const restored = normalizeDeliveryState({
    version: 1,
    active: true,
    riskLevel: "extreme",
    criteria: [{ id: 7, description: "bad", status: "verified", evidence: [] }],
    risks: [null],
    review: { status: "passed", revision: "latest" },
    mutationRevision: -4,
    completed: true,
    completionRevision: 0,
    reminders: -2,
  });
  assert.equal(restored.riskLevel, "low");
  assert.deepEqual(restored.criteria, []);
  assert.deepEqual(restored.risks, []);
  assert.equal(restored.review, undefined);
  assert.equal(restored.mutationRevision, 0);
  assert.equal(restored.completed, false);
  assert.equal(restored.reminders, 0);

  const semantic = normalizeDeliveryState({
    version: 1,
    active: true,
    riskLevel: "low",
    criteria: [],
    risks: [
      { id: "R1", description: "Valid high risk", level: "high", status: "open", blocking: false },
      { id: "R2", description: "Invalid acceptance", level: "low", status: "accepted", blocking: false },
    ],
    review: {
      status: "passed",
      revision: 0,
      contractRevision: 0,
      recordedAt: new Date().toISOString(),
    },
  });
  assert.equal(semantic.riskLevel, "high");
  assert.deepEqual(semantic.risks.map((risk) => risk.id), ["R1"]);
  assert.equal(semantic.review, undefined);
});
