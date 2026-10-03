import { getRequestDictionary } from "@/i18n/server";

export default async function Loading() {
  const copy = (await getRequestDictionary()).state;
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-shell py-6"
      role="status"
    >
      <span className="sr-only">{copy.loading}</span>
      <div className="animate-pulse space-y-6 motion-reduce:animate-none">
        <div className="space-y-3">
          <div className="h-4 w-36 rounded-full bg-muted" />
          <div className="h-7 w-full max-w-xl rounded-md bg-muted" />
          <div className="h-5 w-full max-w-2xl rounded-lg bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              className="h-28 rounded-md border bg-card"
              key={`loading-card-${index + 1}`}
            />
          ))}
        </div>
        <div className="h-80 rounded-md border bg-card" />
      </div>
    </div>
  );
}
