import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <section className="w-full max-w-xl rounded-3xl border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-primary">
          NOT FOUND
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">404</h1>
        <p className="mt-3 text-xl font-medium">页面不存在</p>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          访问的路径不存在或已下线。请检查链接，或返回地图。
        </p>
        <Link className={buttonVariants({ className: "mt-6" })} href="/map">
          返回地图
        </Link>
      </section>
    </main>
  );
}
