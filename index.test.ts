import assert from "node:assert/strict";
import test from "node:test";
import deliveryController from "./index.ts";

type Handler = (event: any, ctx: any) => unknown;

/**
 * A session that, like codemode's nested calls, keeps only entries the extension appends itself:
 * nested tool results never reach the branch, so their `details` cannot carry state.
 */
function nestedSession() {
  const entries: Array<{ id: string; type: string; customType?: string; data?: unknown }> = [];
  const tools = new Map<string, any>();
  const handlers = new Map<string, Handler[]>();
  const active = { names: [] as string[] };
  const ctx = {
    sessionManager: {
      getLeafId: () => entries.at(-1)?.id ?? null,
      getBranch: () => entries,
    },
    ui: { notify() {} },
  };
  deliveryController({
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) => entries.push({ id: `e${entries.length + 1}`, type: "custom", customType, data }),
    getActiveTools: () => active.names,
    setActiveTools: (names: string[]) => { active.names = names; },
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand() {},
    registerMessageRenderer() {},
    sendMessage() {},
  } as any);
  const call = async (name: string, params: unknown) => {
    const result = await tools.get(name).execute("parent/1", params, undefined, undefined, ctx);
    return result.content[0].text as string;
  };
  const emit = (name: string, event: unknown) => {
    for (const handler of handlers.get(name) ?? []) handler(event, ctx);
  };
  return { call, emit };
}

test("delivery actions called from codemode persist without their tool result in the transcript", async () => {
  const session = nestedSession();
  await session.call("delivery_start", { objective: "Fix the callback", riskLevel: "low", criteria: ["Tests pass"] });
  await session.call("delivery", { action: "evidence", criterionId: "C1", outcome: "passed", summary: "npm test passed" });
  assert.match(await session.call("delivery", { action: "complete" }), /Delivery gate passed/);
});

test("edits made by a codemode script make earlier evidence stale", async () => {
  const session = nestedSession();
  await session.call("delivery_start", { objective: "Fix the callback", riskLevel: "low", criteria: ["Tests pass"] });
  await session.call("delivery", { action: "evidence", criterionId: "C1", outcome: "passed", summary: "npm test passed" });
  session.emit("tool_execution_start", { toolCallId: "parent/2", toolName: "edit", args: { path: "src/a.ts" }, parentToolCallId: "parent" });
  session.emit("tool_execution_end", { toolCallId: "parent/2", toolName: "edit", isError: false, parentToolCallId: "parent" });
  assert.match(await session.call("delivery", { action: "complete" }), /C1 has no evidence after mutation revision 1/);
});
