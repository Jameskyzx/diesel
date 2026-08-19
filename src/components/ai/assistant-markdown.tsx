import { ExternalLink } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { interpolate } from "@/i18n/dictionaries";

const markdownPlugins = [remarkGfm];

function normalizedExternalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password
    )
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function safeAssistantMarkdownUrl(
  value: string,
  allowedExternalUrls: readonly string[] = [],
): string {
  const url = value.trim();
  if (
    (url.startsWith("/") &&
      !url.startsWith("//") &&
      !url.includes("\\")) ||
    url.startsWith("#") ||
    url.startsWith("?")
  ) {
    return url;
  }

  const normalized = normalizedExternalUrl(url);
  return normalized !== null &&
    allowedExternalUrls.some(
      (allowedUrl) => normalizedExternalUrl(allowedUrl) === normalized,
    )
    ? normalized
    : "";
}

const markdownComponents: Components = {
  a({ children, href, title }) {
    if (!href) {
      return <span>{children}</span>;
    }

    const external = /^https?:\/\//iu.test(href);
    return (
      <a
        className="inline-flex items-baseline gap-1 break-all font-medium text-emerald-800 underline decoration-emerald-700/35 underline-offset-2 hover:decoration-emerald-700"
        href={href}
        rel={external ? "noopener noreferrer" : undefined}
        target={external ? "_blank" : undefined}
        title={title}
      >
        {children}
        {external ? (
          <ExternalLink
            aria-hidden="true"
            className="relative top-0.5 inline size-3 shrink-0"
          />
        ) : null}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-emerald-700/35 bg-emerald-50/60 py-1 pl-3 text-slate-600">
        {children}
      </blockquote>
    );
  },
  code({ children, className }) {
    return (
      <code
        className={`rounded bg-slate-900/[0.07] px-1 py-0.5 font-mono text-[0.88em] text-slate-800 ${className ?? ""}`}
      >
        {children}
      </code>
    );
  },
  h1({ children }) {
    return (
      <h3 className="mt-4 mb-2 text-base font-semibold text-[#17382e]">
        {children}
      </h3>
    );
  },
  h2({ children }) {
    return (
      <h4 className="mt-4 mb-2 text-sm font-semibold text-[#17382e]">
        {children}
      </h4>
    );
  },
  h3({ children }) {
    return (
      <h5 className="mt-3 mb-1.5 text-sm font-semibold text-[#17382e]">
        {children}
      </h5>
    );
  },
  h4({ children }) {
    return (
      <h6 className="mt-3 mb-1.5 text-sm font-semibold text-[#17382e]">
        {children}
      </h6>
    );
  },
  h5({ children }) {
    return (
      <p className="mt-3 mb-1 font-semibold text-[#17382e]">{children}</p>
    );
  },
  h6({ children }) {
    return (
      <p className="mt-3 mb-1 font-semibold text-[#17382e]">{children}</p>
    );
  },
  hr() {
    return <hr className="my-4 border-black/10" />;
  },
  input({ checked, type }) {
    if (type !== "checkbox") {
      return null;
    }
    return (
      <input
        checked={checked}
        className="mr-1.5 accent-emerald-800"
        disabled
        readOnly
        tabIndex={-1}
        type="checkbox"
      />
    );
  },
  li({ children }) {
    return <li className="my-1 pl-0.5">{children}</li>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
  },
  p({ children }) {
    return (
      <p className="my-2 whitespace-pre-wrap leading-6 first:mt-0 last:mb-0">
        {children}
      </p>
    );
  },
  pre({ children }) {
    return (
      <pre className="my-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
        {children}
      </pre>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
          {children}
        </table>
      </div>
    );
  },
  td({ children }) {
    return (
      <td className="border-t border-black/10 px-3 py-2 align-top">
        {children}
      </td>
    );
  },
  th({ children }) {
    return (
      <th className="bg-slate-50 px-3 py-2 font-semibold text-slate-700">
        {children}
      </th>
    );
  },
  ul({ children, className }) {
    const taskList = className?.includes("contains-task-list");
    return (
      <ul
        className={
          taskList
            ? "my-2 list-none space-y-1 pl-0"
            : "my-2 list-disc space-y-1 pl-5"
        }
      >
        {children}
      </ul>
    );
  },
};

export function AssistantMarkdown({
  allowedExternalUrls = [],
  content,
  hiddenImage = "[Model image hidden]",
  hiddenImageWithAlt = "[Model image hidden: {alt}]",
}: {
  allowedExternalUrls?: readonly string[];
  content: string;
  hiddenImage?: string;
  hiddenImageWithAlt?: string;
}) {
  const components: Components = {
    ...markdownComponents,
    img({ alt }) {
      return (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900">
          {alt
            ? interpolate(hiddenImageWithAlt, { alt })
            : hiddenImage}
        </span>
      );
    },
  };

  return (
    <div className="min-w-0 text-slate-700" data-testid="assistant-markdown">
      <ReactMarkdown
        components={components}
        remarkPlugins={markdownPlugins}
        skipHtml
        urlTransform={(value) =>
          safeAssistantMarkdownUrl(value, allowedExternalUrls)
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
