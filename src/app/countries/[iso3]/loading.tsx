import { LoaderCircle } from "lucide-react";

export default function CountryRouteLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="grid min-h-[70dvh] place-items-center px-6 text-center"
      role="status"
    >
      <div>
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto size-8 animate-spin text-primary motion-reduce:animate-none"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          正在恢复国家地图与详情…
        </p>
      </div>
    </main>
  );
}
