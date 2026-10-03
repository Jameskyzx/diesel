"use client";

import { ArrowUpRight, ChevronRight, Database, House, Map, MessageSquareText, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { useLocale } from "@/components/i18n/locale-provider";
import { notifyPublicNavigationIntent } from "@/lib/public-navigation-intent";
import { cn } from "@/lib/utils";

const navigationItems = [
  { href: "/", icon: House, label: "home", matches: (path: string) => path === "/" },
  { href: "/chat", icon: MessageSquareText, label: "chat", matches: (path: string) => path.startsWith("/chat") },
  { href: "/map", icon: Map, label: "map", matches: (path: string) => path === "/map" || path.startsWith("/countries/") },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const { dictionary } = useLocale();
  const currentPage = navigationItems.find((item) => item.matches(pathname));

  return (
    <header className="app-header" data-testid="app-navigation-shell">
      <div aria-hidden="true" className="app-sidebar-surface" />
      <Link
        aria-label={dictionary.header.brandHome}
        className="app-brand"
        href="/"
        onNavigate={notifyPublicNavigationIntent}
      >
        <Image alt="" aria-hidden="true" className="size-11 shrink-0 object-contain" data-testid="brand-engine-icon" height={44} preload sizes="44px" src="/brand/diesel-chibi.png" width={44} />
        <span className="min-w-0">
          <span className="block text-base font-semibold tracking-tight">Global Diesel</span>
          <span className="brand-subtitle mt-1 block text-[10px]">{dictionary.header.subtitle}</span>
        </span>
      </Link>

      <div className="app-toolbar">
        <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground lg:flex">
          <Database aria-hidden="true" className="size-4" />
          <span>{dictionary.workspace.name}</span>
          <ChevronRight aria-hidden="true" className="size-3" />
          <span className="font-medium text-foreground">{currentPage ? dictionary.header[currentPage.label] : dictionary.workspace.name}</span>
        </div>
        <div className="ml-auto shrink-0"><LocaleToggle /></div>
        <Link
          className="ml-3 hidden h-9 shrink-0 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
          href="/chat"
          onNavigate={notifyPublicNavigationIntent}
          title={dictionary.header.openChat}
        >
          {dictionary.header.analyze}<ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <nav aria-label={dictionary.header.navLabel} className="app-navigation" data-testid="workspace-sidebar">
        <p className="sidebar-section-label">{dictionary.workspace.navigation}</p>
        {navigationItems.map(({ href, icon: Icon, label, matches }) => (
          <Link
            aria-current={matches(pathname) ? "page" : undefined}
            className={cn("sidebar-link", matches(pathname) && "sidebar-link-active")}
            href={href}
            key={href}
            onNavigate={notifyPublicNavigationIntent}
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span>{dictionary.header[label]}</span>
          </Link>
        ))}
        <div className="sidebar-evidence-note">
          <ShieldCheck aria-hidden="true" className="mb-3 size-5" />
          <p className="text-sm font-medium">{dictionary.workspace.readOnly}</p>
          <p className="mt-2 text-xs leading-5">{dictionary.workspace.boundaryNote}</p>
        </div>
        <p className="sidebar-footnote">{dictionary.workspace.evidenceFirst}</p>
      </nav>
    </header>
  );
}
