import { z } from "zod";
import { savedAnalysisSchema, type SavedAnalysis } from "./schemas";

export const ANALYSES_STORAGE_KEY = "diesel_saved_analyses_v1";
export const MAX_SAVED_ANALYSES = 10;
export const MAX_ANALYSES_BYTES = 4_000_000;
const archiveSchema = z.array(savedAnalysisSchema).max(MAX_SAVED_ANALYSES)
  .refine(items => new Set(items.map(item => item.id)).size === items.length);

/** Local archives are user-controlled snapshots, never authoritative server evidence. */
export function readAnalyses(storage: Pick<Storage, "getItem">): SavedAnalysis[] {
  const raw = storage.getItem(ANALYSES_STORAGE_KEY);
  if (raw === null) return [];
  if (raw.length > MAX_ANALYSES_BYTES || new TextEncoder().encode(raw).byteLength > MAX_ANALYSES_BYTES) throw new Error("Archive too large");
  return archiveSchema.parse(JSON.parse(raw));
}

export function writeAnalyses(storage: Pick<Storage, "setItem">, analyses: SavedAnalysis[]): void {
  const raw = JSON.stringify(archiveSchema.parse(analyses));
  if (new TextEncoder().encode(raw).byteLength > MAX_ANALYSES_BYTES) throw new Error("Archive full");
  // Never evict somebody's previous work to make space.
  storage.setItem(ANALYSES_STORAGE_KEY, raw);
}

export function saveAnalysis(storage: Pick<Storage, "getItem" | "setItem">, analysis: SavedAnalysis): void {
  writeAnalyses(storage, [savedAnalysisSchema.parse(analysis), ...readAnalyses(storage).filter(item => item.id !== analysis.id)]);
}

export function downloadAnalysisFile(filename: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function reportHtml(element: HTMLElement, locale: string): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button,script,style,iframe,object,embed,form,input,img").forEach(node => node.remove());
  clone.querySelectorAll("details").forEach(node => { node.open = true; });
  clone.querySelectorAll("*").forEach(node => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith("on") || ["style", "id"].includes(attribute.name)) node.removeAttribute(attribute.name);
    }
  });
  return `<!doctype html><html lang="${locale === "zh-CN" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Diesel analysis</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:auto;padding:24px;color:#182433}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3df;padding:12px;vertical-align:top;text-align:left}section,article,details{margin:16px 0}blockquote{border-left:3px solid #aaa;padding:12px;white-space:pre-wrap}a{color:#005bbb}p{overflow-wrap:anywhere}h1{font-size:24px}@media print{body{padding:0;font-size:11px}details{break-inside:avoid}a{color:inherit}}</style></head><body>${clone.innerHTML}</body></html>`;
}
