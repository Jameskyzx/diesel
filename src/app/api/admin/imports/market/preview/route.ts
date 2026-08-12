import { NextResponse } from "next/server";

import { handleAdminRoute } from "@/server/http/admin-route";
import {
  readFormDataRequest,
  readUtf8File,
} from "@/server/http/request-body";
import { previewMarketCsv } from "@/server/services/governance-service";
import {
  MAX_MARKET_CSV_FILE_BYTES,
  MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES,
} from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAdminRoute(request, "editor", async (principal) => {
    const formData = await readFormDataRequest(
      request,
      MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES,
    );
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "请选择 CSV 文件。",
          },
        },
        { status: 400 },
      );
    }
    if (file.size > MAX_MARKET_CSV_FILE_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: "CSV 文件不得超过 2 MB。",
          },
        },
        { status: 413 },
      );
    }

    return NextResponse.json(
      await previewMarketCsv(
        {
          content: await readUtf8File(file),
          fileName: file.name,
        },
        principal,
      ),
    );
  });
}
