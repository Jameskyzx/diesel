import { z } from "zod";

const apiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().trim().min(1),
      })
      .passthrough(),
  })
  .passthrough();

const safeApiErrorCodes = [
  "AI_NOT_CONFIGURED",
  "INTERNAL_ERROR",
  "INVALID_INPUT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "REQUEST_TIMEOUT",
] as const;

export type SafeApiErrorCode = (typeof safeApiErrorCodes)[number];

const safeApiErrorCodeSchema = z.enum(safeApiErrorCodes);

export async function parseApiErrorCode(
  response: Response,
): Promise<SafeApiErrorCode | null> {
  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    const code = safeApiErrorCodeSchema.safeParse(parsed.data.error.code);
    return code.success ? code.data : null;
  } catch {
    return null;
  }
}

export function parseSerializedApiErrorCode(
  message: string,
): SafeApiErrorCode | null {
  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(JSON.parse(message));
    if (!parsed.success) return null;
    const code = safeApiErrorCodeSchema.safeParse(parsed.data.error.code);
    return code.success ? code.data : null;
  } catch {
    return null;
  }
}

/**
 * 从服务端 {error:{message}} 错误信封中提取已脱敏的消息；
 * 解析失败时退回调用方提供的固定文案。
 */
export async function parseApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * AI SDK 等客户端库可能把非 2xx body 序列化到 Error.message。
 * 只接受既定错误信封中的 message；非 JSON、HTML 或任意原始错误文本
 * 一律回退固定文案，避免把上游细节直接渲染给用户。
 */
export function parseSerializedApiErrorMessage(
  message: string,
  fallback: string,
): string {
  try {
    const parsed = apiErrorEnvelopeSchema.safeParse(JSON.parse(message));
    return parsed.success ? parsed.data.error.message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 把 fetch/解析失败转换为用户可见消息：只接受普通 Error 的 message，
 * ZodError（schema 解析失败的原始问题清单）不向用户展示，退回固定文案。
 */
export function toUserFacingErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function getErrorCode(error: unknown): string {
  try {
    if (!(error instanceof Error)) {
      return "UNKNOWN_ERROR";
    }

    const constructorName = Object.getPrototypeOf(error)?.constructor?.name;
    return typeof constructorName === "string" &&
      /^(?:Error|[A-Za-z][A-Za-z0-9_]{0,55}(?:Error|Exception))$/.test(
        constructorName,
      )
      ? constructorName
      : "UNKNOWN_ERROR";
  } catch {
    return "UNKNOWN_ERROR";
  }
}
