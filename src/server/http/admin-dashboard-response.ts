import "server-only";

import { types as nodeUtilTypes } from "node:util";

import {
  adminPrincipalSchema,
  adminDashboardResponseSchema,
  type AdminDashboardResponse,
  type AdminPrincipal,
} from "@/features/admin/schemas";

const arrayIsArray = Array.isArray;
const dateGetTime = Date.prototype.getTime;
const dateToISOString = Date.prototype.toISOString;
const isProxy = nodeUtilTypes.isProxy;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;

export class AdminDashboardResponseContractError extends Error {
  constructor() {
    super("The admin dashboard response did not satisfy its wire contract.");
    this.name = "AdminDashboardResponseContractError";
  }
}

function normalizeJsonWireValue(
  value: unknown,
  ancestors: WeakSet<object>,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AdminDashboardResponseContractError();
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== "object") {
    throw new AdminDashboardResponseContractError();
  }

  if (isProxy(value)) {
    throw new AdminDashboardResponseContractError();
  }

  if (value instanceof Date) {
    if (
      objectGetPrototypeOf(value) !== Date.prototype ||
      reflectOwnKeys(value).length !== 0
    ) {
      throw new AdminDashboardResponseContractError();
    }
    const timestamp = reflectApply(dateGetTime, value, []);
    if (!Number.isFinite(timestamp)) {
      throw new AdminDashboardResponseContractError();
    }
    const normalized = reflectApply(dateToISOString, value, []);
    if (typeof normalized !== "string") {
      throw new AdminDashboardResponseContractError();
    }
    return normalized;
  }

  if (ancestors.has(value)) {
    throw new AdminDashboardResponseContractError();
  }

  ancestors.add(value);
  try {
    if (arrayIsArray(value)) {
      if (objectGetPrototypeOf(value) !== Array.prototype) {
        throw new AdminDashboardResponseContractError();
      }

      const descriptors = objectGetOwnPropertyDescriptors(value) as Record<
        string,
        PropertyDescriptor
      >;
      const ownKeys = reflectOwnKeys(value);
      const lengthDescriptor = descriptors["length"];
      const lengthValue: unknown = lengthDescriptor?.value;
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        typeof lengthValue !== "number" ||
        !Number.isInteger(lengthValue) ||
        lengthValue < 0 ||
        ownKeys.length !== lengthValue + 1
      ) {
        throw new AdminDashboardResponseContractError();
      }

      const normalized = new Array<unknown>(lengthValue);
      for (let index = 0; index < lengthValue; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) {
          throw new AdminDashboardResponseContractError();
        }
        normalized[index] = normalizeJsonWireValue(
          descriptor.value,
          ancestors,
        );
      }
      return normalized;
    }

    const prototype = objectGetPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AdminDashboardResponseContractError();
    }

    const descriptors = objectGetOwnPropertyDescriptors(value);
    const normalized: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of reflectOwnKeys(value)) {
      if (typeof key !== "string") {
        throw new AdminDashboardResponseContractError();
      }
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw new AdminDashboardResponseContractError();
      }
      normalized[key] = normalizeJsonWireValue(
        descriptor.value,
        ancestors,
      );
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function admitAdminDashboardResponse(
  value: unknown,
  principal: AdminPrincipal,
): AdminDashboardResponse {
  try {
    const authenticatedPrincipal = adminPrincipalSchema.safeParse(principal);
    if (!authenticatedPrincipal.success) {
      throw new AdminDashboardResponseContractError();
    }
    const normalized = normalizeJsonWireValue(value, new WeakSet<object>());
    const parsed = adminDashboardResponseSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new AdminDashboardResponseContractError();
    }
    if (
      authenticatedPrincipal.data.role === "editor" &&
      (parsed.data.auditLogs.length > 0 ||
        parsed.data.drafts.some(
          (draft) =>
            draft.createdBy !== authenticatedPrincipal.data.email ||
            (draft.reviewContext.publishedBaseline !== null &&
              draft.reviewContext.publishedBaseline.publishedBy !== null),
        ))
    ) {
      throw new AdminDashboardResponseContractError();
    }
    return parsed.data;
  } catch (error: unknown) {
    if (error instanceof AdminDashboardResponseContractError) {
      throw error;
    }
    throw new AdminDashboardResponseContractError();
  }
}
