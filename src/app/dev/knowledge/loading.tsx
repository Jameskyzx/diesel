import { LoaderCircle } from "lucide-react";

export default function KnowledgeDebugLoading() {
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div>
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto size-8 animate-spin text-primary"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          正在加载知识库调试工具…
        </p>
      </div>
    </main>
  );
}

