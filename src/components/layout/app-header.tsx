"use client";

import { ArrowUpRight, House, Map, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { useLocale } from "@/components/i18n/locale-provider";
import { notifyPublicNavigationIntent } from "@/lib/public-navigation-intent";
import { cn } from "@/lib/utils";

type NavigationItem = {
  href: string;
  icon: typeof House;
  label: "chat" | "home" | "map";
  matches: (pathname: string) => boolean;
};

const navigationItems: NavigationItem[] = [
  { href: "/", icon: House, label: "home", matches: (pathname) => pathname === "/" },
  { href: "/chat", icon: MessageSquareText, label: "chat", matches: (pathname) => pathname.startsWith("/chat") },
  {
    href: "/map",
    icon: Map,
    label: "map",
    matches: (pathname) => pathname === "/map" || pathname.startsWith("/countries/"),
  },
];

export function AppHeader() {
  const pathname = usePathname();
  const { dictionary, locale } = useLocale();
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;

    const revealCurrentLink = () => {
      const currentLink = navigation.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      if (!currentLink) return;

      const navigationBounds = navigation.getBoundingClientRect();
      const currentLinkBounds = currentLink.getBoundingClientRect();
      const visibleLeft = navigationBounds.left + navigation.clientLeft;
      const visibleRight = navigationBounds.right - navigation.clientLeft;

      if (currentLinkBounds.left < visibleLeft) {
        navigation.scrollLeft += currentLinkBounds.left - visibleLeft;
      } else if (currentLinkBounds.right > visibleRight) {
        navigation.scrollLeft += currentLinkBounds.right - visibleRight;
      }
    };

    revealCurrentLink();
    window.addEventListener("resize", revealCurrentLink);
    return () => window.removeEventListener("resize", revealCurrentLink);
  }, [locale, pathname]);

  return (
    <header className="sticky top-0 z-50 border-b bg-card shadow-[0_1px_2px_rgb(24_36_51_/_0.03)]" data-testid="app-navigation-shell">
      <div className="page-shell flex h-16 items-center gap-3">
        <Link
          aria-label={dictionary.header.brandHome}
          className="group flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/"
          onNavigate={notifyPublicNavigationIntent}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold tracking-tight text-white">
            GD
          </span>
          <span className="block min-w-0">
            <span className="block text-sm leading-none font-semibold tracking-tight text-foreground sm:text-base">
              Global Diesel
            </span>
            <span className="mt-1.5 hidden text-[10px] text-muted-foreground sm:block">
              {dictionary.header.subtitle}
            </span>
          </span>
        </Link>
        <div className="ml-auto shrink-0">
          <LocaleToggle />
        </div>
        <Link
          className="hidden h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/25 lg:inline-flex"
          href="/chat"
          onNavigate={notifyPublicNavigationIntent}
          title={dictionary.header.openChat}
        >
          {dictionary.header.analyze}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="border-t">
        <nav
          aria-label={dictionary.header.navLabel}
          className="page-shell flex min-w-0 items-center gap-4 overflow-x-auto sm:gap-6"
          ref={navigationRef}
        >
          {navigationItems.map(({ href, icon: Icon, label, matches }) => {
            const active = matches(pathname);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
                href={href}
                key={href}
                onNavigate={notifyPublicNavigationIntent}
              >
                <Icon aria-hidden="true" className="size-4" />
                {dictionary.header[label]}
              </Link>
            );
          })}
        </nav>

      </div>
    </header>
  );
}
