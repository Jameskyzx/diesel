import { pathToFileURL } from "node:url";

import {
  productListResponseSchema,
  type ProductListResponse,
} from "@/features/product-fit/schemas";

const maximumPayloadBytes = 65_536;

const expectedDemoProducts = {
  "DEMO-ENG-100": {
    id: "00000000-0000-4000-8000-000000000201",
    sourceId: "00000000-0000-4000-8000-000000000003",
    specificationVersion: "demo-v1",
  },
  "DEMO-ENG-200": {
    id: "00000000-0000-4000-8000-000000000202",
    sourceId: "00000000-0000-4000-8000-000000000003",
    specificationVersion: "demo-v1",
  },
} as const;

function fail(): never {
  throw new Error("Unexpected public product payload");
}

export function validatePublicProductReleasePayload(
  value: unknown,
): ProductListResponse {
  const parsed = productListResponseSchema.safeParse(value);
  if (!parsed.success) fail();

  const products = parsed.data.products;
  const expectedModelCodes = Object.keys(expectedDemoProducts).sort();
  const actualModelCodes = products
    .map(({ modelCode }) => modelCode)
    .sort();
  if (
    products.length !== expectedModelCodes.length ||
    JSON.stringify(actualModelCodes) !== JSON.stringify(expectedModelCodes)
  ) {
    fail();
  }

  for (const product of products) {
    const expectation = expectedDemoProducts[
      product.modelCode as keyof typeof expectedDemoProducts
    ];
    if (
      expectation === undefined ||
      product.id !== expectation.id ||
      product.isDemo !== true ||
      product.source.id !== expectation.sourceId ||
      product.source.isDemo !== true ||
      product.specificationVersion !== expectation.specificationVersion
    ) {
      fail();
    }
  }

  return parsed.data;
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maximumPayloadBytes) fail();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(await readStandardInput());
  } catch {
    fail();
  }
  validatePublicProductReleasePayload(value);
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  main().catch(() => {
    console.error("Unexpected public product payload");
    process.exitCode = 1;
  });
}
