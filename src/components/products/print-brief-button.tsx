"use client";

import { Button } from "@/components/ui/button";

export function PrintBriefButton({ label }: { label: string }) {
  return <Button type="button" onClick={() => window.print()} data-testid="print-brief">{label}</Button>;
}
