import type { ReactNode } from "react";

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  kicker: string;
  title: ReactNode;
  titleLabel?: string;
};

export function PageHeader({ actions, description, kicker, title, titleLabel }: PageHeaderProps) {
  return (
    <section className="workspace-page-header">
      <div className="min-w-0">
        <p className="section-kicker">{kicker}</p>
        <h1 aria-label={titleLabel} className="mt-1 text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </section>
  );
}
