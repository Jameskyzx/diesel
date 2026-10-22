import { NextResponse } from "next/server";
import { z } from "zod";

import { handleAdminRoute } from "@/server/http/admin-route";
import { readFeedbackSourceFile } from "@/server/services/feedback-read-service";

export const runtime = "nodejs";

/** An original upload behind a feedback batch, shown to editors only. */
export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }): Promise<Response> {
  return handleAdminRoute(request, "editor", "/api/admin/feedback/files/:fileId", async (principal) => {
    const fileId = z.uuid().parse((await context.params).fileId);
    const file = await readFeedbackSourceFile(fileId, principal);
    if (!file) return NextResponse.json({ error: { code: "NOT_FOUND", message: "原始文件不存在。" } }, { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Disposition": `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Content-Type": file.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
