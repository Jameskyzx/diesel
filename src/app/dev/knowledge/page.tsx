import { notFound } from "next/navigation";

import { KnowledgeDebugConsole } from "@/components/knowledge/knowledge-debug-console";
import { isKnowledgeDebugEnabled } from "@/server/services/knowledge-service";

export const dynamic = "force-dynamic";

export default function KnowledgeDebugPage() {
  if (!isKnowledgeDebugEnabled()) {
    notFound();
  }

  return <KnowledgeDebugConsole />;
}

