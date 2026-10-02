export type RiskLevel = "low" | "medium" | "high";
export type CriterionStatus = "pending" | "verified" | "failed";
export type RiskStatus = "open" | "mitigated" | "accepted";
export type ReviewStatus = "pending" | "passed" | "failed" | "unavailable";

export interface EvidenceRecord {
  summary: string;
  command?: string;
  result?: string;
  revision: number;
  recordedAt: string;
}

export interface Criterion {
  id: string;
  description: string;
  status: CriterionStatus;
  evidence: EvidenceRecord[];
}

export interface DeliveryRisk {
  id: string;
  description: string;
  level: RiskLevel;
  status: RiskStatus;
  blocking: boolean;
  rationale?: string;
}

export interface DeliveryReview {
  status: ReviewStatus;
  reviewer?: string;
  summary?: string;
  rationale?: string;
  revision: number;
  contractRevision: number;
  recordedAt: string;
}

export interface DeliveryState {
  version: 1;
  active: boolean;
  objective?: string;
  riskLevel: RiskLevel;
  criteria: Criterion[];
  risks: DeliveryRisk[];
  review?: DeliveryReview;
  contractRevision: number;
  mutationRevision: number;
  mutationPaths: string[];
  completed: boolean;
  completionRevision?: number;
  reminders: number;
}

export interface CompletionAssessment {
  passed: boolean;
  blockers: string[];
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function now(): string {
  return new Date().toISOString();
}

function nextId(prefix: string, used: Array<{ id: string }>): string {
  const numbers = used
    .map((item) => Number(item.id.slice(prefix.length)))
    .filter((value) => Number.isInteger(value) && value > 0);
  return `${prefix}${Math.max(0, ...numbers) + 1}`;
}

export function createDeliveryState(): DeliveryState {
  return {
    version: 1,
    active: false,
    riskLevel: "low",
    criteria: [],
    risks: [],
    contractRevision: 0,
    mutationRevision: 0,
    mutationPaths: [],
    completed: false,
    reminders: 0,
  };
}

export function normalizeDeliveryState(value: unknown): DeliveryState {
  if (!value || typeof value !== "object") return createDeliveryState();
  const candidate = value as Partial<DeliveryState>;
  if (candidate.version !== 1) return createDeliveryState();

  const criteria = Array.isArray(candidate.criteria)
    ? candidate.criteria.filter((item): item is Criterion => {
        if (!item || typeof item !== "object") return false;
        const criterion = item as Partial<Criterion>;
        return typeof criterion.id === "string"
          && typeof criterion.description === "string"
          && ["pending", "verified", "failed"].includes(criterion.status ?? "")
          && Array.isArray(criterion.evidence);
      }).map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
        status: criterion.status,
        evidence: criterion.evidence.flatMap((item): EvidenceRecord[] => {
          if (!item || typeof item !== "object") return [];
          const evidence = item as Partial<EvidenceRecord>;
          if (typeof evidence.summary !== "string"
            || !Number.isInteger(evidence.revision)
            || evidence.revision! < 0
            || typeof evidence.recordedAt !== "string") return [];
          return [{
            summary: evidence.summary,
            command: typeof evidence.command === "string" ? evidence.command : undefined,
            result: typeof evidence.result === "string" ? evidence.result : undefined,
            revision: evidence.revision!,
            recordedAt: evidence.recordedAt,
          }];
        }),
      }))
    : [];
  const risks = Array.isArray(candidate.risks)
    ? candidate.risks.flatMap((item): DeliveryRisk[] => {
        if (!item || typeof item !== "object") return [];
        const risk = item as Partial<DeliveryRisk>;
        if (typeof risk.id !== "string"
          || typeof risk.description !== "string"
          || !["low", "medium", "high"].includes(risk.level ?? "")
          || !["open", "mitigated", "accepted"].includes(risk.status ?? "")
          || typeof risk.blocking !== "boolean"
          || (risk.status !== "open" && (typeof risk.rationale !== "string" || !risk.rationale.trim()))) return [];
        return [{
          id: risk.id,
          description: risk.description,
          level: risk.level!,
          status: risk.status!,
          blocking: risk.blocking,
          rationale: typeof risk.rationale === "string" ? risk.rationale : undefined,
        }];
      })
    : [];
  const declaredRiskLevel = ["low", "medium", "high"].includes(candidate.riskLevel ?? "")
    ? candidate.riskLevel as RiskLevel
    : "low";
  const riskLevel = risks.reduce(
    (highest, risk) => RISK_ORDER[risk.level] > RISK_ORDER[highest] ? risk.level : highest,
    declaredRiskLevel,
  );
  const sourceReview = candidate.review;
  const review: DeliveryReview | undefined = sourceReview
    && typeof sourceReview === "object"
    && ["pending", "passed", "failed", "unavailable"].includes(sourceReview.status)
    && Number.isInteger(sourceReview.revision)
    && sourceReview.revision >= 0
    && Number.isInteger(sourceReview.contractRevision)
    && sourceReview.contractRevision >= 0
    && typeof sourceReview.recordedAt === "string"
    && (!["passed", "failed"].includes(sourceReview.status)
      || (typeof sourceReview.reviewer === "string"
        && Boolean(sourceReview.reviewer.trim())
        && typeof sourceReview.summary === "string"
        && Boolean(sourceReview.summary.trim())))
    && (sourceReview.status !== "unavailable"
      || (typeof sourceReview.rationale === "string" && Boolean(sourceReview.rationale.trim())))
      ? {
          status: sourceReview.status,
          reviewer: typeof sourceReview.reviewer === "string" ? sourceReview.reviewer : undefined,
          summary: typeof sourceReview.summary === "string" ? sourceReview.summary : undefined,
          rationale: typeof sourceReview.rationale === "string" ? sourceReview.rationale : undefined,
          revision: sourceReview.revision,
          contractRevision: sourceReview.contractRevision,
          recordedAt: sourceReview.recordedAt,
        }
      : undefined;

  const normalized: DeliveryState = {
    ...createDeliveryState(),
    version: 1,
    active: candidate.active === true,
    objective: typeof candidate.objective === "string" ? candidate.objective : undefined,
    riskLevel,
    criteria,
    risks,
    review,
    contractRevision: Number.isInteger(candidate.contractRevision) ? Math.max(0, candidate.contractRevision!) : 0,
    mutationRevision: Number.isInteger(candidate.mutationRevision) ? Math.max(0, candidate.mutationRevision!) : 0,
    mutationPaths: Array.isArray(candidate.mutationPaths)
      ? candidate.mutationPaths.filter((path): path is string => typeof path === "string")
      : [],
    completed: false,
    completionRevision: undefined,
    reminders: Number.isInteger(candidate.reminders) ? Math.max(0, candidate.reminders!) : 0,
  };
  const completionRevision = Number.isInteger(candidate.completionRevision) && candidate.completionRevision! >= 0
    ? candidate.completionRevision
    : undefined;
  if (candidate.completed === true
    && completionRevision === normalized.mutationRevision
    && assessCompletion(normalized).passed) {
    normalized.completed = true;
    normalized.completionRevision = completionRevision;
  }
  return normalized;
}

export function beginDelivery(
  state: DeliveryState,
  objective: string,
  descriptions: string[],
  riskLevel: RiskLevel = "low",
): DeliveryState {
  const criteria = descriptions
    .map((description) => description.trim())
    .filter(Boolean)
    .map((description, index): Criterion => ({
      id: `C${index + 1}`,
      description,
      status: "pending",
      evidence: [],
    }));

  return {
    ...createDeliveryState(),
    active: true,
    objective: objective.trim(),
    riskLevel,
    criteria,
    contractRevision: state.contractRevision + 1,
    mutationRevision: state.mutationRevision,
    mutationPaths: [...state.mutationPaths],
    reminders: state.reminders,
  };
}

export function addCriterion(state: DeliveryState, description: string): DeliveryState {
  const trimmed = description.trim();
  if (!trimmed) throw new Error("Criterion description cannot be empty.");
  return {
    ...state,
    active: true,
    completed: false,
    criteria: [
      ...state.criteria,
      { id: nextId("C", state.criteria), description: trimmed, status: "pending", evidence: [] },
    ],
    contractRevision: state.contractRevision + 1,
  };
}

export function recordEvidence(
  state: DeliveryState,
  criterionId: string,
  outcome: "passed" | "failed",
  summary: string,
  command?: string,
  result?: string,
): DeliveryState {
  const index = state.criteria.findIndex((criterion) => criterion.id === criterionId);
  if (index < 0) throw new Error(`Unknown criterion: ${criterionId}`);
  if (!summary.trim()) throw new Error("Evidence summary cannot be empty.");

  const evidence: EvidenceRecord = {
    summary: summary.trim(),
    command: command?.trim() || undefined,
    result: result?.trim() || undefined,
    revision: state.mutationRevision,
    recordedAt: now(),
  };
  const criteria = state.criteria.map((criterion, criterionIndex) =>
    criterionIndex === index
      ? {
          ...criterion,
          status: outcome === "passed" ? "verified" as const : "failed" as const,
          evidence: [...criterion.evidence, evidence],
        }
      : criterion,
  );
  return { ...state, active: true, completed: false, criteria };
}

export function recordRisk(
  state: DeliveryState,
  input: {
    id?: string;
    description: string;
    level: RiskLevel;
    status: RiskStatus;
    blocking?: boolean;
    rationale?: string;
  },
): DeliveryState {
  const description = input.description.trim();
  if (!description) throw new Error("Risk description cannot be empty.");
  if (input.status !== "open" && !input.rationale?.trim()) {
    throw new Error("Mitigated or accepted risks require a rationale.");
  }

  const id = input.id || nextId("R", state.risks);
  const risk: DeliveryRisk = {
    id,
    description,
    level: input.level,
    status: input.status,
    blocking: input.blocking ?? input.level === "high",
    rationale: input.rationale?.trim() || undefined,
  };
  const existing = state.risks.findIndex((item) => item.id === id);
  const risks = existing < 0
    ? [...state.risks, risk]
    : state.risks.map((item, index) => index === existing ? risk : item);
  const riskLevel = RISK_ORDER[input.level] > RISK_ORDER[state.riskLevel] ? input.level : state.riskLevel;
  return {
    ...state,
    active: true,
    completed: false,
    riskLevel,
    risks,
    contractRevision: state.contractRevision + 1,
  };
}

export function recordReview(
  state: DeliveryState,
  status: ReviewStatus,
  reviewer?: string,
  summary?: string,
  rationale?: string,
): DeliveryState {
  if ((status === "passed" || status === "failed") && !reviewer?.trim()) {
    throw new Error("A completed review requires a reviewer identifier.");
  }
  if ((status === "passed" || status === "failed") && !summary?.trim()) {
    throw new Error("A completed review requires a summary.");
  }
  if (status === "unavailable" && !rationale?.trim()) {
    throw new Error("An unavailable review requires a rationale.");
  }
  return {
    ...state,
    active: true,
    completed: false,
    review: {
      status,
      reviewer: reviewer?.trim() || undefined,
      summary: summary?.trim() || undefined,
      rationale: rationale?.trim() || undefined,
      revision: state.mutationRevision,
      contractRevision: state.contractRevision,
      recordedAt: now(),
    },
  };
}

export function noteMutation(state: DeliveryState, path?: string): DeliveryState {
  const paths = path?.trim()
    ? [...new Set([...state.mutationPaths, path.trim()])]
    : [...state.mutationPaths];
  return {
    ...state,
    mutationRevision: state.mutationRevision + 1,
    mutationPaths: paths,
    completed: false,
    completionRevision: undefined,
  };
}

function stripShellLiterals(command: string): string {
  const output: string[] = [];
  let heredocEnd: string | undefined;
  for (const line of command.split("\n")) {
    if (heredocEnd) {
      if (line.trim() === heredocEnd) heredocEnd = undefined;
      output.push("");
      continue;
    }

    let cleaned = "";
    let quote: "'" | '"' | "`" | undefined;
    let escaped = false;
    for (const char of line) {
      if (escaped) {
        cleaned += quote ? " " : char;
        escaped = false;
      } else if (char === "\\") {
        cleaned += quote ? " " : char;
        escaped = true;
      } else if (quote) {
        cleaned += " ";
        if (char === quote) quote = undefined;
      } else if (char === "'" || char === '"' || char === "`") {
        quote = char;
        cleaned += " ";
      } else {
        cleaned += char;
      }
    }
    output.push(cleaned);
    const marker = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (marker) heredocEnd = marker[1];
  }
  return output.join("\n");
}

/** Best-effort shell heuristic; direct edit/write events remain authoritative. */
export function commandMayMutate(command: string): boolean {
  const value = stripShellLiterals(command)
    .replace(/(?:\d?>{1,2}|&>)\s*\/dev\/(?:null|stdout|stderr)\b/g, "")
    .trim();
  if (!value) return false;
  if (/\bcargo\s+fmt\b/i.test(value) && !/\bcargo\s+fmt\b[^\n]*--check\b/i.test(value)) return true;
  if (/\bgofmt\b[^\n]*\s-w(?:\s|$)/i.test(value)) return true;
  const patterns = [
    /(^|[;&|]\s*)(rm|mv|cp|install|touch|mkdir|rmdir|truncate|dd|patch)\b/i,
    /\b(sed\b[^\n]*\s-i(?:\s|$)|perl\b[^\n]*\s-pi(?:\s|$))/i,
    /(^|[^<])>{1,2}(?![>&])/m,
    /(^|[;&|]\s*)(?:sudo\s+)?tee\b/i,
    /\bgit\s+(apply|checkout|restore|reset|clean|merge|rebase|cherry-pick|commit|stash|switch)\b/i,
    /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade|link|unlink)\b/i,
    /\b(prettier|biome|ruff|eslint)\b[^\n]*(--write|--fix)\b/i,
    /\bgo\s+fmt\b/i,
    /\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b/i,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

export function assessCompletion(state: DeliveryState): CompletionAssessment {
  const blockers: string[] = [];
  if (!state.active) blockers.push("No active delivery contract.");
  if (!state.objective?.trim()) blockers.push("The delivery objective is missing.");
  if (state.criteria.length === 0) blockers.push("No acceptance criteria are recorded.");

  for (const criterion of state.criteria) {
    if (criterion.status === "pending") blockers.push(`${criterion.id} is pending: ${criterion.description}`);
    if (criterion.status === "failed") blockers.push(`${criterion.id} failed: ${criterion.description}`);
    if (criterion.status === "verified") {
      const fresh = criterion.evidence.some((evidence) => evidence.revision === state.mutationRevision);
      if (!fresh) blockers.push(`${criterion.id} has no evidence after mutation revision ${state.mutationRevision}.`);
    }
  }

  for (const risk of state.risks) {
    if (risk.blocking && risk.status === "open") blockers.push(`${risk.id} is an unresolved blocking risk: ${risk.description}`);
  }

  const reviewRequired = state.riskLevel === "medium" || state.riskLevel === "high";
  if (!state.review) {
    if (reviewRequired) blockers.push(`${state.riskLevel} risk requires an independent review.`);
  } else if (state.review.revision !== state.mutationRevision) {
    blockers.push(`Review predates mutation revision ${state.mutationRevision}.`);
  } else if (state.review.contractRevision !== state.contractRevision) {
    blockers.push(`Review predates contract revision ${state.contractRevision}.`);
  } else if (state.review.status === "pending") {
    blockers.push("Independent review is pending.");
  } else if (state.review.status === "failed") {
    blockers.push(`Independent review failed: ${state.review.summary ?? "no summary"}`);
  } else if (state.review.status === "unavailable") {
    if (state.riskLevel === "high") blockers.push("High-risk work requires a completed independent review.");
    else if (!state.review.rationale?.trim()) blockers.push("Unavailable review has no rationale.");
  }

  return { passed: blockers.length === 0, blockers };
}

export function completeDelivery(state: DeliveryState): { state: DeliveryState; assessment: CompletionAssessment } {
  const assessment = assessCompletion(state);
  if (!assessment.passed) return { state: { ...state, completed: false }, assessment };
  return {
    state: {
      ...state,
      completed: true,
      completionRevision: state.mutationRevision,
    },
    assessment,
  };
}

export function formatDeliveryStatus(state: DeliveryState): string {
  if (!state.active) return "Delivery controller: inactive.";
  const lines = [
    `Delivery: ${state.completed ? "complete" : "open"}`,
    `Objective: ${state.objective || "not recorded"}`,
    `Risk: ${state.riskLevel}`,
    `Mutation revision: ${state.mutationRevision}`,
  ];
  if (state.mutationPaths.length > 0) lines.push(`Changed paths: ${state.mutationPaths.join(", ")}`);
  lines.push("Criteria:");
  if (state.criteria.length === 0) lines.push("- none");
  for (const criterion of state.criteria) {
    const latest = criterion.evidence.at(-1);
    lines.push(`- ${criterion.id} [${criterion.status}] ${criterion.description}${latest ? ` — ${latest.summary}` : ""}`);
  }
  if (state.risks.length > 0) {
    lines.push("Risks:");
    for (const risk of state.risks) lines.push(`- ${risk.id} [${risk.status}${risk.blocking ? ", blocking" : ""}] ${risk.description}`);
  }
  if (state.review) {
    lines.push(`Review: ${state.review.status}${state.review.reviewer ? ` by ${state.review.reviewer}` : ""}${state.review.summary ? ` — ${state.review.summary}` : ""}`);
  }
  const assessment = assessCompletion(state);
  if (!assessment.passed) {
    lines.push("Completion blockers:");
    for (const blocker of assessment.blockers) lines.push(`- ${blocker}`);
  }
  return lines.join("\n");
}
