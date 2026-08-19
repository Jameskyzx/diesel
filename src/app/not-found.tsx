import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getRequestDictionary } from "@/i18n/server";

export default async function NotFound() {
  const copy = (await getRequestDictionary()).state;
  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <section className="w-full max-w-xl rounded-3xl border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-primary">
          404
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">404</h1>
        <p className="mt-3 text-xl font-medium">{copy.notFoundHeading}</p>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {copy.notFoundBody}
        </p>
        <Link className={buttonVariants({ className: "mt-6" })} href="/map">
          {copy.returnMap}
        </Link>
      </section>
    </main>
  );
}
