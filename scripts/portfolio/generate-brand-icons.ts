import { readFile, writeFile } from "node:fs/promises";

import sharp from "sharp";

async function main(): Promise<void> {
  // Reuse the approved header artwork; no remote resources or runtime processing.
  const source = await readFile("public/brand/diesel-chibi.png");
  const favicon = await sharp(source).resize(64, 64).png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${favicon.toString("base64")}"/></svg>\n`;

  await writeFile("src/app/icon.svg", svg);
  await sharp(source).resize(180, 180).png().toFile("public/apple-touch-icon.png");
  console.log("Generated browser and Apple touch icons from the diesel-engine artwork.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
