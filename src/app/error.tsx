"use client";

import { Button } from "@/components/ui/button";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <section
        aria-labelledby="error-title"
        className="w-full max-w-xl rounded-3xl border bg-card p-8 shadow-sm"
      >
        <p className="text-sm font-semibold text-destructive">页面加载失败</p>
        <h1
          className="mt-3 text-3xl font-semibold tracking-tight"
          id="error-title"
        >
          暂时无法显示此页面
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          请重试。如果问题持续出现，请联系系统管理员并提供错误编号。
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            错误编号：{error.digest}
          </p>
        ) : null}
        <Button className="mt-6" onClick={reset} type="button">
          重新加载
        </Button>
      </section>
    </main>
  );
}
