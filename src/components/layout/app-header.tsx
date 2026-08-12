"use client";

import { Bot, House, Map, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavigationItem = {
  href: string;
  label: string;
  icon: typeof House;
  matches: (pathname: string) => boolean;
};

const navigationItems: NavigationItem[] = [
  { href: "/", icon: House, label: "首页", matches: (pathname) => pathname === "/" },
  { href: "/chat", icon: MessageSquareText, label: "对话", matches: (pathname) => pathname.startsWith("/chat") },
  {
    href: "/map",
    icon: Map,
    label: "地图",
    matches: (pathname) => pathname === "/map" || pathname.startsWith("/countries/"),
  },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#111918] text-white shadow-[0_8px_24px_rgb(10_28_24_/_0.12)]">
      <div className="mx-auto flex min-h-16 w-full max-w-[1680px] items-center gap-2 px-4 sm:gap-6 sm:px-6 lg:px-8">
        <nav aria-label="主导航" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {navigationItems.map(({ href, icon: Icon, label, matches }) => {
            const active = matches(pathname);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[#b8e548]/50 sm:px-3",
                  active
                    ? "bg-white/12 text-white"
                    : "text-slate-400 hover:bg-white/8 hover:text-white",
                )}
                href={href}
                key={href}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 border-l border-white/10 pl-4 text-xs text-slate-400 md:flex">
          <span className="size-1.5 rounded-full bg-[#b8e548] shadow-[0_0_0_3px_rgb(184_229_72_/_0.14)]" />
          数据服务正常
        </div>
        <Link
          aria-label="打开 AI 对话"
          className="hidden size-10 shrink-0 place-items-center rounded-md border border-white/15 text-slate-300 transition-colors hover:border-[#b8e548]/60 hover:bg-white/8 hover:text-white focus-visible:ring-[3px] focus-visible:ring-[#b8e548]/50 sm:grid"
          href="/chat"
          title="打开 AI 对话"
        >
          <Bot aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </header>
  );
}
