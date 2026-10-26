import { assessCompletion, type Criterion, type DeliveryState } from "./state.ts";

/** Theme slots the views use; `paint` maps them to colors, or leaves text plain. */
export type Tone = "accent" | "success" | "error" | "warning" | "muted" | "dim";
export type Paint = (tone: Tone, text: string) => string;

const plain: Paint = (_tone, text) => text;

type CriterionMark = "verified" | "stale" | "failed" | "pending";

function criterionMark(criterion: Criterion, revision: number): CriterionMark {
  if (criterion.status === "failed") return "failed";
  if (criterion.status === "pending") return "pending";
  return criterion.evidence.some((evidence) => evidence.revision === revision) ? "verified" : "stale";
}

const MARKS: Record<CriterionMark, [Tone, string]> = {
  verified: ["success", "✓"],
  stale: ["warning", "↻"],
  failed: ["error", "✗"],
  pending: ["muted", "○"],
};

/** One line: where the delivery stands. */
export function deliveryHeadline(state: DeliveryState, paint: Paint = plain): string {
  if (!state.active) return paint("muted", "inactive");
  if (state.completed) return paint("success", "✓ complete");
  const verified = state.criteria.filter((criterion) => criterionMark(criterion, state.mutationRevision) === "verified").length;
  const { blockers } = assessCompletion(state);
  const progress = `${verified}/${state.criteria.length}`;
  const outcome = blockers.length === 0
    ? paint("success", "ready")
    : paint("warning", `${blockers.length} ${blockers.length === 1 ? "blocker" : "blockers"}`);
  return [paint("accent", progress), paint("muted", `${state.riskLevel} risk`), outcome].join(paint("dim", " · "));
}

/** A detail line; when it wraps, continuation lines align under `text`, past `lead`. */
export interface DetailRow {
  lead: string;
  text: string;
}

const BLANK: DetailRow = { lead: "", text: "" };

/** The full contract, for the expanded view. */
export function deliveryDetail(state: DeliveryState, paint: Paint = plain): DetailRow[] {
  if (!state.active) return [{ lead: "", text: paint("muted", "No active delivery.") }];
  const rows: DetailRow[] = [{ lead: "", text: state.objective || paint("muted", "No objective recorded.") }];
  if (state.mutationPaths.length > 0) {
    rows.push({ lead: "", text: paint("dim", `changed ${state.mutationPaths.join(", ")}`) });
  }
  rows.push(BLANK);

  for (const criterion of state.criteria) {
    const [tone, mark] = MARKS[criterionMark(criterion, state.mutationRevision)];
    rows.push({ lead: `${paint(tone, mark)} ${paint("dim", criterion.id)} `, text: criterion.description });
    const latest = criterion.evidence.at(-1);
    if (latest) rows.push({ lead: "     ", text: paint("dim", latest.summary) });
  }

  if (state.risks.length > 0) {
    rows.push(BLANK);
    for (const risk of state.risks) {
      const tone: Tone = risk.status !== "open" ? "success" : risk.blocking ? "error" : "warning";
      const flags = [risk.status, risk.blocking ? "blocking" : undefined].filter(Boolean).join(", ");
      rows.push({ lead: `${paint(tone, "!")} ${paint("dim", risk.id)} `, text: `${risk.description} ${paint("dim", `(${flags})`)}` });
    }
  }

  if (state.review) {
    const { status, reviewer, summary, rationale } = state.review;
    const tone: Tone = status === "passed" ? "success" : status === "failed" ? "error" : "warning";
    const note = summary ?? rationale;
    rows.push(BLANK, {
      lead: `${paint("dim", "review")} `,
      text: `${paint(tone, status)}${reviewer ? ` · ${reviewer}` : ""}${note ? paint("dim", ` — ${note}`) : ""}`,
    });
  }

  // Pending, failed and stale criteria already show in the list above.
  const remaining = assessCompletion(state).blockers
    .filter((blocker) => !state.criteria.some((criterion) => blocker.startsWith(`${criterion.id} `)));
  if (!state.completed && remaining.length > 0) {
    rows.push(BLANK);
    for (const blocker of remaining) rows.push({ lead: `${paint("warning", "›")} `, text: blocker });
  }
  return rows;
}

export function joinRows(rows: DetailRow[]): string {
  return rows.map((row) => `${row.lead}${row.text}`).join("\n");
}
