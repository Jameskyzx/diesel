import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminFormDataRequest,
} from "@/server/http/admin-route";
import {
  MAX_CATALOG_SPREADSHEET_BYTES,
  previewCatalogSpreadsheet,
} from "@/server/services/governance-service";
import { MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAdminRoute(
    request,
    "editor",
    "/api/admin/imports/catalog/preview",
    async (principal) => {
      const formData = await readAdminFormDataRequest(request, MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES);
      const file = formData.get("file");

      if (!(file instanceof File)) {
        return NextResponse.json({ error: { code: "INVALID_INPUT", message: "请选择 .xlsx 文件。" } }, { status: 400 });
      }
      if (file.size > MAX_CATALOG_SPREADSHEET_BYTES) {
        return NextResponse.json({ error: { code: "FILE_TOO_LARGE", message: "工作簿不得超过 2 MB。" } }, { status: 413 });
      }

      return NextResponse.json(
        await previewCatalogSpreadsheet({ content: new Uint8Array(await file.arrayBuffer()), fileName: file.name }, principal),
      );
    },
  );
}
