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
    <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#f8f7f2]/90 backdrop-blur-xl">
      <div className="page-shell flex min-h-[4.5rem] items-center gap-1.5 sm:gap-8">
        <Link
          aria-label={dictionary.header.brandHome}
          className="group flex shrink-0 items-center gap-3"
          href="/"
          onNavigate={notifyPublicNavigationIntent}
        >
          <span className="grid size-9 place-items-center rounded-full bg-[#11382d] text-[10px] font-bold tracking-[0.08em] text-[#d9f28f] shadow-[0_8px_24px_rgb(17_56_45_/_0.18)]">
            GD
          </span>
          <span className="hidden md:block">
            <span className="display-title block text-[1.05rem] leading-none font-semibold text-[#142b24]">
              Global Diesel
            </span>
            <span className="mt-1 block text-[9px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
              {dictionary.header.subtitle}
            </span>
          </span>
        </Link>

        <nav
          aria-label={dictionary.header.navLabel}
          className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-black/[0.06] bg-white/70 p-1 shadow-sm"
          ref={navigationRef}
        >
          {navigationItems.map(({ href, icon: Icon, label, matches }) => {
            const active = matches(pathname);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-emerald-700/20 sm:px-4",
                  active
                    ? "bg-[#163b30] text-white shadow-sm"
                    : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900",
                )}
                href={href}
                key={href}
                onNavigate={notifyPublicNavigationIntent}
              >
                <Icon aria-hidden="true" className="hidden size-4 sm:block" />
                {dictionary.header[label]}
              </Link>
            );
          })}
        </nav>

        <LocaleToggle />

        <Link
          className="hidden h-10 shrink-0 items-center gap-2 rounded-full bg-[#dff1cc] px-4 text-sm font-semibold text-[#17382e] transition-all hover:bg-[#cfe9b2] focus-visible:ring-[3px] focus-visible:ring-emerald-700/20 lg:inline-flex"
          href="/chat"
          onNavigate={notifyPublicNavigationIntent}
          title={dictionary.header.openChat}
        >
          {dictionary.header.analyze}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </header>
  );
}
