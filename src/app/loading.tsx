export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-8"
      role="status"
    >
      <span className="sr-only">正在加载页面</span>
      <div className="animate-pulse space-y-8">
        <div className="space-y-3">
          <div className="h-4 w-36 rounded-full bg-muted" />
          <div className="h-10 w-full max-w-xl rounded-xl bg-muted" />
          <div className="h-5 w-full max-w-2xl rounded-lg bg-muted" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              className="h-40 rounded-3xl border bg-card"
              key={`loading-card-${index + 1}`}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
