import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isUnmodifiedPrimaryClick,
  notifyPublicNavigationIntent,
  subscribeToPublicNavigationIntent,
} from "@/lib/public-navigation-intent";

let windowTarget: EventTarget;
const subscriptions: Array<() => void> = [];

beforeEach(() => {
  windowTarget = new EventTarget();
  Object.defineProperty(windowTarget, "location", {
    get() {
      throw new Error("Navigation intent must not read or publish a URL.");
    },
  });
  vi.stubGlobal("window", windowTarget);
});

afterEach(() => {
  try {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

function subscribe(listener: () => void): () => void {
  const unsubscribe = subscribeToPublicNavigationIntent(listener);
  subscriptions.push(unsubscribe);
  return unsubscribe;
}

describe("unmodified primary click classification", () => {
  const primary = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    shiftKey: false,
  };

  it.each(Array.from({ length: 16 }, (_, mask) => ({ mask })))(
    "classifies all modifier combinations, mask $mask",
    ({ mask }) => {
      expect(isUnmodifiedPrimaryClick({
        ...primary,
        altKey: Boolean(mask & 1),
        ctrlKey: Boolean(mask & 2),
        metaKey: Boolean(mask & 4),
        shiftKey: Boolean(mask & 8),
      })).toBe(mask === 0);
    },
  );

  it.each([-1, 1, 2, 3, 4])("does not cancel for button %s", (button) => {
    expect(isUnmodifiedPrimaryClick({ ...primary, button })).toBe(false);
  });

  it("respects an already-prevented ordinary activation", () => {
    expect(isUnmodifiedPrimaryClick({ ...primary, defaultPrevented: true })).toBe(false);
  });

  it("needs no browser global, target, or URL to classify the activation", () => {
    vi.stubGlobal("window", undefined);
    const event = Object.defineProperties({ ...primary }, {
      currentTarget: { get() { throw new Error("Must not inspect the anchor."); } },
      target: { get() { throw new Error("Must not inspect the event target."); } },
    });

    expect(isUnmodifiedPrimaryClick(event)).toBe(true);
  });
});

describe("public navigation intent", () => {
  it("notifies and cancels synchronously before the navigation caller continues", () => {
    const controller = new AbortController();
    const order: string[] = [];
    subscribe(() => {
      controller.abort();
      order.push("cancelled");
    });

    order.push("before");
    notifyPublicNavigationIntent();
    order.push("after");

    expect(controller.signal.aborted).toBe(true);
    expect(order).toEqual(["before", "cancelled", "after"]);
  });

  it("dispatches only a payload-free Event without accessing the current URL", () => {
    const dispatch = vi.spyOn(windowTarget, "dispatchEvent");

    notifyPublicNavigationIntent();

    expect(dispatch).toHaveBeenCalledTimes(1);
    const event = dispatch.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(Event);
    if (event === undefined) throw new Error("Expected a navigation intent event.");
    expect(event.constructor).toBe(Event);
    expect(event.type.length).toBeGreaterThan(0);
    for (const property of ["detail", "url", "href", "destination"]) {
      expect(property in event).toBe(false);
    }
  });

  it("is safe when no product panel is subscribed", () => {
    expect(() => notifyPublicNavigationIntent()).not.toThrow();
    expect(() => notifyPublicNavigationIntent()).not.toThrow();
  });

  it("removes each subscription independently and allows repeated cleanup", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribe(first);
    const unsubscribeSecond = subscribe(second);

    notifyPublicNavigationIntent();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeFirst();
    notifyPublicNavigationIntent();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    unsubscribeSecond();
    notifyPublicNavigationIntent();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("does not retain an obsolete panel listener after cleanup and remount", () => {
    const obsolete = vi.fn();
    const current = vi.fn();
    const unsubscribeObsolete = subscribe(obsolete);
    unsubscribeObsolete();

    const unsubscribeCurrent = subscribe(current);
    // A repeated cleanup from the old owner must not remove the new owner.
    unsubscribeObsolete();
    notifyPublicNavigationIntent();
    expect(obsolete).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);

    unsubscribeCurrent();
    notifyPublicNavigationIntent();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("cleans up the subscribed window rather than a later global target", () => {
    const listener = vi.fn();
    const originalTarget = windowTarget;
    const dispatch = vi.spyOn(originalTarget, "dispatchEvent");
    const unsubscribe = subscribe(listener);
    notifyPublicNavigationIntent();
    const event = dispatch.mock.calls[0]?.[0];
    if (event === undefined) throw new Error("Expected a navigation intent event.");

    vi.stubGlobal("window", new EventTarget());
    notifyPublicNavigationIntent();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    originalTarget.dispatchEvent(new Event(event.type));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

async function parseTsx(path: string): Promise<ts.SourceFile> {
  return ts.createSourceFile(
    path,
    await readFile(resolve(process.cwd(), path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function findNodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const matches: T[] = [];
  function visit(node: ts.Node): void {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function calls(root: ts.Node, name: string): ts.CallExpression[] {
  return findNodes(root, (node): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === name,
  );
}

function namedCallbackBody(root: ts.Node, name: string): ts.Block {
  const declarations = findNodes(root, (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  );
  expect(declarations).toHaveLength(1);
  const callback = declarations[0]?.initializer;
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body)) {
    throw new Error(`Expected ${name} to have a block callback body.`);
  }
  return callback.body;
}

function expectDirectAssignment(
  statement: ts.Statement | undefined,
  source: ts.SourceFile,
  target: string,
  operator: ts.SyntaxKind,
  value: string,
): void {
  if (!statement || !ts.isExpressionStatement(statement) ||
    !ts.isBinaryExpression(statement.expression)) {
    throw new Error(`Expected a direct assignment to ${target}.`);
  }
  expect(statement.expression.left.getText(source)).toBe(target);
  expect(statement.expression.operatorToken.kind).toBe(operator);
  expect(statement.expression.right.getText(source)).toBe(value);
}

describe("public navigation intent wiring", () => {
  it("notifies from all three Header Link source locations through onNavigate", async () => {
    const source = await parseTsx("src/components/layout/app-header.tsx");
    const links = findNodes(
      source,
      (node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName) && node.tagName.text === "Link",
    );

    // Brand, mapped primary navigation items, and the separate Analyze CTA.
    expect(links).toHaveLength(3);
    for (const link of links) {
      const attribute = link.attributes.properties.find(
        (node): node is ts.JsxAttribute =>
          ts.isJsxAttribute(node) && ts.isIdentifier(node.name) &&
          node.name.text === "onNavigate",
      );
      const initializer = attribute?.initializer;
      const handler = initializer && ts.isJsxExpression(initializer)
        ? initializer.expression
        : undefined;
      expect(handler?.getText(source)).toBe("notifyPublicNavigationIntent");
    }
  });

  it("retires initial and queued auto-runs on navigation but only aborts the current request during cleanup", async () => {
    const source = await parseTsx("src/components/products/product-fit-panel.tsx");
    const intentCalls = calls(source, "subscribeToPublicNavigationIntent");
    expect(intentCalls).toHaveLength(1);
    const intentCall = intentCalls[0];
    if (intentCall === undefined) throw new Error("Expected one intent subscription.");
    expect(intentCall.arguments[0]?.getText(source)).toBe("cancelPendingEvaluation");

    const declaration = intentCall.parent;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
      throw new Error("The effect must retain its subscription cleanup callback.");
    }
    const cleanupName = declaration.name.text;
    let ancestor: ts.Node | undefined = declaration.parent;
    while (ancestor && !ts.isArrowFunction(ancestor)) ancestor = ancestor.parent;
    if (!ancestor || !ts.isArrowFunction(ancestor) || !ts.isBlock(ancestor.body)) {
      throw new Error("Expected the subscription inside the cancellation effect.");
    }
    const effect = ancestor;
    const effectBody = ancestor.body;
    expect(ts.isCallExpression(effect.parent) &&
      ts.isIdentifier(effect.parent.expression) &&
      effect.parent.expression.text === "useEffect").toBe(true);
    expect(calls(effectBody, "registerNavigationGuard").some((call) =>
      call.arguments[0]?.getText(source) === "cancelPendingEvaluation",
    )).toBe(true);

    const cancellation = namedCallbackBody(effectBody, "cancelPendingEvaluation");
    expect(cancellation.statements).toHaveLength(3);
    expectDirectAssignment(
      cancellation.statements[0], source, "autoRanRef.current", ts.SyntaxKind.EqualsToken, "true",
    );
    expectDirectAssignment(
      cancellation.statements[1], source, "autoRunEpochRef.current", ts.SyntaxKind.PlusEqualsToken, "1",
    );
    const cancellationAbort = cancellation.statements[2];
    if (!cancellationAbort || !ts.isExpressionStatement(cancellationAbort) ||
      !ts.isCallExpression(cancellationAbort.expression)) {
      throw new Error("Expected a direct abort after retiring automatic evaluation.");
    }
    expect(cancellationAbort.expression.expression.getText(source)).toBe("abortCurrentEvaluation");
    expect(cancellationAbort.expression.arguments).toHaveLength(0);

    const abortBody = namedCallbackBody(effectBody, "abortCurrentEvaluation");
    const abortIdentifiers = findNodes(abortBody, ts.isIdentifier).map((node) => node.text);
    // StrictMode's effect cleanup must not consume a still-valid shared-link attempt.
    expect(abortIdentifiers).not.toContain("autoRanRef");
    expect(abortIdentifiers).not.toContain("autoRunEpochRef");
    expect(calls(abortBody, "cancelPendingEvaluation")).toHaveLength(0);

    const cleanup = effectBody.statements.find(ts.isReturnStatement)?.expression;
    if (!cleanup || !(ts.isArrowFunction(cleanup) || ts.isFunctionExpression(cleanup)) ||
      !ts.isBlock(cleanup.body)) {
      throw new Error("Expected the effect's returned cleanup function.");
    }
    const cleanupCalls = cleanup.body.statements.map((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
        throw new Error("Expected direct unsubscribe, abort, and unregister cleanup calls.");
      }
      return statement.expression;
    });
    expect(cleanupCalls.map((call) => call.expression.getText(source))).toEqual([
      cleanupName, "abortCurrentEvaluation", "registerNavigationGuard",
    ]);
    expect(cleanupCalls[0]?.arguments).toHaveLength(0);
    expect(cleanupCalls[1]?.arguments).toHaveLength(0);
    expect(cleanupCalls[2]?.arguments.map((argument) => argument.getText(source))).toEqual(["null"]);
    expect(calls(cleanup.body, "cancelPendingEvaluation")).toHaveLength(0);
  });

  it("binds the queued zero-delay auto-run to its scheduling epoch and rejects a retired epoch before evaluation", async () => {
    const source = await parseTsx("src/components/products/product-fit-panel.tsx");
    const timers = calls(source, "setTimeout").filter((call) =>
      call.arguments[0] !== undefined && calls(call.arguments[0], "runEvaluation").length > 0,
    );
    expect(timers).toHaveLength(1);
    const timer = timers[0];
    if (!timer || !ts.isVariableDeclaration(timer.parent) || !ts.isIdentifier(timer.parent.name)) {
      throw new Error("Expected the auto-run timer to retain its cleanup handle.");
    }
    expect(timer.arguments[1]?.getText(source)).toBe("0");
    const timerName = timer.parent.name.text;
    const timerStatement = timer.parent.parent.parent;
    if (!ts.isVariableStatement(timerStatement) || !ts.isBlock(timerStatement.parent)) {
      throw new Error("Expected the auto-run timer directly inside its effect body.");
    }
    const effectBody = timerStatement.parent;
    const effect = effectBody.parent;
    if (!ts.isArrowFunction(effect) || !ts.isCallExpression(effect.parent) ||
      !ts.isIdentifier(effect.parent.expression) || effect.parent.expression.text !== "useEffect") {
      throw new Error("Expected an auto-run useEffect.");
    }
    const epochDeclarations = effectBody.statements.flatMap((statement) =>
      ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
    ).filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "autoRunEpoch");
    expect(epochDeclarations).toHaveLength(1);
    const epoch = epochDeclarations[0];
    if (!epoch || !ts.isVariableDeclarationList(epoch.parent)) {
      throw new Error("Expected a local scheduling epoch.");
    }
    expect(epoch.parent.flags & ts.NodeFlags.Const).toBe(ts.NodeFlags.Const);
    expect(epoch.initializer?.getText(source)).toBe("autoRunEpochRef.current");
    expect(epoch.getStart(source)).toBeLessThan(timer.getStart(source));

    const callback = timer.arguments[0];
    if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
      throw new Error("Expected a guarded auto-run timer callback.");
    }
    expect(callback.body.statements).toHaveLength(2);
    const guard = callback.body.statements[0];
    if (!guard || !ts.isIfStatement(guard) || !ts.isBinaryExpression(guard.expression)) {
      throw new Error("Expected the epoch guard before runEvaluation.");
    }
    expect(guard.expression.left.getText(source)).toBe("autoRunEpochRef.current");
    expect(guard.expression.operatorToken.kind).toBe(ts.SyntaxKind.ExclamationEqualsEqualsToken);
    expect(guard.expression.right.getText(source)).toBe("autoRunEpoch");
    expect(guard.elseStatement).toBeUndefined();
    const rejected = ts.isBlock(guard.thenStatement) ? [...guard.thenStatement.statements] : [guard.thenStatement];
    expect(rejected).toHaveLength(1);
    const earlyReturn = rejected[0];
    if (!earlyReturn || !ts.isReturnStatement(earlyReturn)) {
      throw new Error("A retired epoch must return without evaluating.");
    }
    expect(earlyReturn.expression).toBeUndefined();
    const evaluation = callback.body.statements[1];
    if (!evaluation || !ts.isExpressionStatement(evaluation) ||
      !ts.isVoidExpression(evaluation.expression) || !ts.isCallExpression(evaluation.expression.expression)) {
      throw new Error("Expected the evaluation only after the epoch guard.");
    }
    expect(evaluation.expression.expression.expression.getText(source)).toBe("runEvaluation");
    expect(evaluation.expression.expression.arguments).toHaveLength(0);
    const cleanup = effectBody.statements.find(ts.isReturnStatement)?.expression;
    if (!cleanup || !ts.isArrowFunction(cleanup)) throw new Error("Expected timer cleanup.");
    const clears = calls(cleanup.body, "clearTimeout");
    expect(clears).toHaveLength(1);
    expect(clears[0]?.arguments[0]?.getText(source)).toBe(timerName);
  });
});
