import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import {
  addCriterion,
  assessCompletion,
  beginDelivery,
  commandMayMutate,
  completeDelivery,
  createDeliveryState,
  formatDeliveryStatus,
  normalizeDeliveryState,
  noteMutation,
  recordEvidence,
  recordReview,
  recordRisk,
  type DeliveryState,
  type ReviewStatus,
  type RiskLevel,
  type RiskStatus,
} from "./state.ts";

const TOOL_NAME = "delivery";
const START_TOOL_NAME = "delivery_start";
const ENTRY_TYPE = "delivery-controller-state";
const MAX_AUTOMATIC_REMINDERS = 2;

const startParameters = Type.Object({
  objective: Type.String({ description: "Requested substantial or risky outcome" }),
  riskLevel: StringEnum(["low", "medium", "high"] as const),
  criteria: Type.Array(Type.String(), {
    minItems: 1,
    description: "Material acceptance criteria that justify gated delivery",
  }),
});

type StartInput = Static<typeof startParameters>;

const deliveryParameters = Type.Object({
  action: StringEnum(["begin", "criteria", "evidence", "risk", "status", "review", "complete"] as const),
  objective: Type.Optional(Type.String({ description: "Requested outcome for begin" })),
  riskLevel: Type.Optional(StringEnum(["low", "medium", "high"] as const)),
  criteria: Type.Optional(Type.Array(Type.String(), { description: "Acceptance criteria for begin" })),
  description: Type.Optional(Type.String({ description: "Criterion or risk description" })),
  criterionId: Type.Optional(Type.String({ description: "Criterion id such as C1" })),
  outcome: Type.Optional(StringEnum(["passed", "failed"] as const)),
  summary: Type.Optional(Type.String({ description: "Concise evidence or review finding" })),
  command: Type.Optional(Type.String({ description: "Command or direct check that produced the evidence" })),
  result: Type.Optional(Type.String({ description: "Observed result, not an expected result" })),
  riskId: Type.Optional(Type.String({ description: "Existing risk id to update" })),
  riskStatus: Type.Optional(StringEnum(["open", "mitigated", "accepted"] as const)),
  blocking: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.String()),
  reviewStatus: Type.Optional(StringEnum(["pending", "passed", "failed", "unavailable"] as const)),
  reviewer: Type.Optional(Type.String({ description: "Independent reviewer or review job identifier" })),
});

type DeliveryInput = Static<typeof deliveryParameters>;

function requireText(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`${field} is required for this delivery action.`);
  return value.trim();
}

function stateFromBranch(entries: readonly unknown[]): DeliveryState {
  const restored = { value: createDeliveryState() };
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as {
      type?: string;
      customType?: string;
      data?: unknown;
      message?: { role?: string; toolName?: string; details?: unknown };
    };
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      const data = entry.data as { state?: unknown } | undefined;
      restored.value = normalizeDeliveryState(data?.state);
      continue;
    }
    if (entry.type === "message" && entry.message?.role === "toolResult"
      && (entry.message.toolName === TOOL_NAME || entry.message.toolName === START_TOOL_NAME)) {
      const details = entry.message.details as { state?: unknown } | undefined;
      if (details?.state) restored.value = normalizeDeliveryState(details.state);
    }
  }
  return restored.value;
}

type Step = { state: DeliveryState; text: string; assessment?: ReturnType<typeof assessCompletion> };

/** One delivery action as a pure transition: the next state and what to say about it. */
function deliveryStep(state: DeliveryState, params: DeliveryInput): Step {
  switch (params.action) {
    case "begin": {
      if (state.objective) throw new Error("A delivery contract is already open. Update it instead of replacing it.");
      const next = beginDelivery(state, requireText(params.objective, "objective"), params.criteria ?? [], (params.riskLevel ?? "low") as RiskLevel);
      return { state: next, text: `Delivery contract opened.\n${formatDeliveryStatus(next)}` };
    }
    case "criteria": {
      const next = addCriterion(state, requireText(params.description, "description"));
      return { state: next, text: `Acceptance criterion added.\n${formatDeliveryStatus(next)}` };
    }
    case "evidence": {
      const criterionId = requireText(params.criterionId, "criterionId");
      const summary = requireText(params.summary, "summary");
      if (!params.outcome) throw new Error("outcome is required for evidence.");
      const next = recordEvidence(state, criterionId, params.outcome, summary, params.command, params.result);
      return { state: next, text: `Evidence recorded for ${criterionId}.\n${formatDeliveryStatus(next)}` };
    }
    case "risk": {
      const next = recordRisk(state, {
        id: params.riskId,
        description: requireText(params.description, "description"),
        level: (params.riskLevel ?? "low") as RiskLevel,
        status: (params.riskStatus ?? "open") as RiskStatus,
        blocking: params.blocking,
        rationale: params.rationale,
      });
      return { state: next, text: `Risk recorded.\n${formatDeliveryStatus(next)}` };
    }
    case "review": {
      if (!params.reviewStatus) throw new Error("reviewStatus is required for review.");
      const next = recordReview(state, params.reviewStatus as ReviewStatus, params.reviewer, params.summary, params.rationale);
      return { state: next, text: `Review recorded.\n${formatDeliveryStatus(next)}` };
    }
    case "status":
      return { state, text: formatDeliveryStatus(state) };
    case "complete": {
      const completed = completeDelivery(state);
      const { assessment } = completed;
      const text = assessment.passed
        ? `Delivery gate passed at mutation revision ${completed.state.mutationRevision}. Final reporting may proceed.`
        : `Delivery gate blocked:\n${assessment.blockers.map((blocker) => `- ${blocker}`).join("\n")}`;
      return { state: completed.state, text, assessment };
    }
    default:
      return { state, text: "" };
  }
}

export default function deliveryController(pi: ExtensionAPI) {
  // The contract lives in the session log: every change is an appended entry, and the current
  // state is read back from the active branch. Nothing here keeps a copy that can drift.
  // Reading the branch is O(entries), so the derived state is kept for the branch tip it was read at.
  // Any new entry moves the tip and the next read derives it again.
  const derived = { leaf: undefined as string | undefined, state: createDeliveryState() };
  const current = (ctx: ExtensionContext): DeliveryState => {
    const leaf = ctx.sessionManager.getLeafId?.() ?? undefined;
    if (leaf !== undefined && leaf === derived.leaf) return derived.state;
    const state = stateFromBranch(ctx.sessionManager.getBranch());
    derived.leaf = leaf;
    derived.state = state;
    return state;
  };
  const commit = (state: DeliveryState): DeliveryState => {
    pi.appendEntry(ENTRY_TYPE, { state });
    return state;
  };
  // Correlates a tool's start with its end, so a mutation is recorded once it has run.
  const pendingMutations = new Map<string, { path?: string }>();

  const setDeliveryToolActive = (enabled: boolean) => {
    const retained = pi.getActiveTools().filter((name) => name !== TOOL_NAME && name !== START_TOOL_NAME);
    pi.setActiveTools([...new Set([...retained, START_TOOL_NAME, ...(enabled ? [TOOL_NAME] : [])])]);
  };

  pi.on("session_start", (_event, ctx) => {
    const state = current(ctx);
    setDeliveryToolActive(state.active && !state.completed);
  });

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return;
    const state = current(ctx);
    if (state.completed || !state.active) {
      commit(createDeliveryState());
      setDeliveryToolActive(false);
    }
  });

  pi.on("tool_execution_start", (event) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      const args = event.args as { path?: unknown };
      pendingMutations.set(event.toolCallId, {
        path: typeof args.path === "string" ? args.path : undefined,
      });
      return;
    }
    if (event.toolName === "bash" || event.toolName === "powershell") {
      const args = event.args as { command?: unknown };
      if (typeof args.command === "string" && commandMayMutate(args.command)) {
        pendingMutations.set(event.toolCallId, {});
      }
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const mutation = pendingMutations.get(event.toolCallId);
    if (!mutation) return;
    pendingMutations.delete(event.toolCallId);
    // Failed or cancelled tools may have changed files before reporting an error.
    commit(noteMutation(current(ctx), mutation.path));
  });

  pi.on("agent_end", (event, ctx) => {
    const state = current(ctx);
    if (state.completed) {
      setDeliveryToolActive(false);
      return;
    }
    const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
    if (lastAssistant?.role === "assistant"
      && ["error", "length", "aborted"].includes(lastAssistant.stopReason)) return;

    if (!state.active) return;
    if (state.reminders >= MAX_AUTOMATIC_REMINDERS) {
      ctx.ui.notify("Delivery remains incomplete; automatic follow-ups exhausted. Run /delivery-status.", "error");
      return;
    }
    const reminded = commit({ ...state, reminders: state.reminders + 1 });
    const assessment = assessCompletion(reminded);
    const blockers = assessment.blockers.length > 0
      ? assessment.blockers.map((blocker) => `- ${blocker}`).join("\n")
      : "- Run delivery complete before claiming completion.";
    pi.sendMessage({
      customType: "delivery-controller-reminder",
      display: true,
      content: `Delivery gate is still open. Resolve the following before the final report:\n${blockers}`,
      details: { state: reminded },
    }, { deliverAs: "followUp", triggerTurn: true });
  });

  pi.registerTool({
    name: START_TOOL_NAME,
    label: "Start delivery gate",
    description: "Load the full delivery gate for substantial, multi-criterion, or medium/high-risk work. Never use for routine low-risk questions or simple edits.",
    promptSnippet: "Start gated delivery only for substantial or risky work",
    promptGuidelines: [
      "Use delivery_start only when work is substantial, has multiple material acceptance criteria, carries medium/high risk, or the user explicitly requests rigorous gated validation. Never use it for routine low-risk questions or simple edits.",
    ],
    parameters: startParameters,
    async execute(_toolCallId, params: StartInput, _signal, _onUpdate, ctx: ExtensionContext) {
      const state = current(ctx);
      if (state.objective) throw new Error("A delivery contract is already open.");
      const next = commit(beginDelivery(state, requireText(params.objective, "objective"), params.criteria, params.riskLevel as RiskLevel));
      setDeliveryToolActive(true);
      return {
        content: [{ type: "text", text: `Delivery contract opened. Full delivery controls are now available.\n${formatDeliveryStatus(next)}` }],
        details: { action: "begin", state: next },
      };
    },
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Delivery",
    description: "Record criteria, evidence, risks, review, and completion after delivery_start opens a gate.",
    promptSnippet: "Control the currently active evidence-backed delivery gate",
    promptGuidelines: [
      "Delivery is active: record evidence after the final mutation and call delivery complete before claiming success.",
      "For medium-risk work, record an independent review with a reviewer identifier, or an explicit unavailable rationale. High-risk work requires a completed independent review.",
    ],
    parameters: deliveryParameters,
    async execute(_toolCallId, params: DeliveryInput, _signal, _onUpdate, ctx: ExtensionContext) {
      const step = deliveryStep(current(ctx), params);
      return {
        content: [{ type: "text" as const, text: step.text }],
        details: { action: params.action, state: step.state, assessment: step.assessment },
      };
    },
  });

  pi.registerCommand("delivery-status", {
    description: "Show the current delivery contract and completion blockers",
    handler: async (_args, ctx) => {
      const state = current(ctx);
      ctx.ui.notify(formatDeliveryStatus(state), state.completed ? "info" : "warning");
    },
  });

  pi.registerCommand("delivery-reset", {
    description: "Reset the current delivery contract",
    handler: async (_args, ctx) => {
      commit(createDeliveryState());
      setDeliveryToolActive(false);
      ctx.ui.notify("Delivery controller reset.", "info");
    },
  });
}
