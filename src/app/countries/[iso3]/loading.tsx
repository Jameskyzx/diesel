import { LoaderCircle } from "lucide-react";
import { getRequestDictionary } from "@/i18n/server";

export default async function CountryRouteLoading() {
  const copy = await getRequestDictionary();
  return (
    <div
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
          {copy.map.loadingDetails}
        </p>
      </div>
    </div>
  );
}
