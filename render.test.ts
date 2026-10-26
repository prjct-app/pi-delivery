import assert from "node:assert/strict";
import test from "node:test";
import { deliveryDetail, deliveryHeadline, joinRows } from "./render.ts";
import { beginDelivery, completeDelivery, createDeliveryState, noteMutation, recordEvidence, recordReview, recordRisk } from "./state.ts";

const objective = "Fix the Jira OAuth callback failure";

test("the headline is a single line with progress, risk and blockers", () => {
  const state = beginDelivery(createDeliveryState(), objective, ["Find the failure", "Keep PKCE intact"], "medium");
  const headline = deliveryHeadline(state);
  assert.equal(headline, "0/2 · medium risk · 3 blockers");
  assert.doesNotMatch(headline, /\n/);
});

test("the headline reports ready and complete states", () => {
  const begun = beginDelivery(createDeliveryState(), objective, ["Tests pass"], "low");
  const ready = recordEvidence(begun, "C1", "passed", "npm test passed");
  assert.equal(deliveryHeadline(ready), "1/1 · low risk · ready");
  assert.equal(deliveryHeadline(completeDelivery(ready).state), "✓ complete");
  assert.equal(deliveryHeadline(createDeliveryState()), "inactive");
});

test("stale evidence is not counted as verified", () => {
  const begun = beginDelivery(createDeliveryState(), objective, ["Tests pass"], "low");
  const stale = noteMutation(recordEvidence(begun, "C1", "passed", "npm test passed"), "src/a.ts");
  assert.match(deliveryHeadline(stale), /^0\/1/);
  assert.match(joinRows(deliveryDetail(stale)), /↻ C1 Tests pass/);
});

test("the detail lists the objective, marked criteria, risks, review and other blockers once", () => {
  const begun = beginDelivery(createDeliveryState(), objective, ["Find the failure", "Keep PKCE intact"], "medium");
  const evidenced = recordEvidence(begun, "C1", "passed", "Callback rejects the state parameter");
  const risky = recordRisk(evidenced, { description: "Token could leak in logs", level: "medium", status: "open", blocking: true });
  const state = recordReview(risky, "unavailable", undefined, undefined, "No reviewer in this session");
  const text = joinRows(deliveryDetail(state));

  assert.equal(deliveryDetail(state)[0].text, objective);
  assert.match(text, /✓ C1 Find the failure\n {5}Callback rejects the state parameter/);
  assert.match(text, /○ C2 Keep PKCE intact/);
  assert.match(text, /! R1 Token could leak in logs \(open, blocking\)/);
  assert.match(text, /review unavailable — No reviewer in this session/);
  assert.match(text, /› R1 is an unresolved blocking risk/);
  assert.doesNotMatch(text, /C2 is pending/);
  assert.doesNotMatch(text, /Mutation revision/);
});
