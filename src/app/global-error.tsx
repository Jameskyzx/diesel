"use client";

import { Button } from "@/components/ui/button";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="grid min-h-screen place-items-center bg-slate-950 px-6 py-16 text-white">
          <section
            aria-labelledby="global-error-title"
            className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8"
          >
            <p className="text-sm font-semibold text-amber-300">系统错误</p>
            <h1
              className="mt-3 text-3xl font-semibold tracking-tight"
              id="global-error-title"
            >
              应用暂时不可用
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              请稍后重试。服务恢复前不会展示未经核验的数据。
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-slate-400">
                错误编号：{error.digest}
              </p>
            ) : null}
            <Button className="mt-6" onClick={reset} type="button">
              重试
            </Button>
          </section>
        </main>
      </body>
    </html>
  );
}
