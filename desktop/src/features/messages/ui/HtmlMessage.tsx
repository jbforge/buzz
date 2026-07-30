import { Code2, EyeOff } from "lucide-react";
import * as React from "react";

import {
  buildSandboxedSrcDoc,
  resolveEmbedHeight,
} from "@/features/messages/lib/htmlArtifact.mjs";
import { useFeatureEnabled } from "@/shared/features";
import { useSmoothCorners } from "@/shared/ui/smoothCorners";

type HtmlMessageProps = {
  /** Raw artifact HTML from the event content. */
  content: string;
  /** `title` tag — short label for the embed header. */
  title?: string;
  /** `alt` tag — plaintext shown when the embed is not rendered. */
  alt?: string;
  /** `height` tag — requested embed height in CSS pixels. */
  height?: string;
};

export default function HtmlMessage({
  content,
  title,
  alt,
  height,
}: HtmlMessageProps) {
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  useSmoothCorners(cardRef);

  const embedsEnabled = useFeatureEnabled("htmlEmbeds");

  // The document is rebuilt only when the artifact changes; a 64 KB string
  // concat on every timeline re-render would be wasted work on a busy channel.
  const srcDoc = React.useMemo(() => buildSandboxedSrcDoc(content), [content]);
  const embedHeight = resolveEmbedHeight(height);
  const label = title ?? "HTML embed";

  return (
    <div
      ref={cardRef}
      className="overflow-hidden rounded-2xl border border-border/70 bg-card/60 text-sm"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/40">
        <Code2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-xs text-foreground/80">
          {label}
        </span>
        <span className="ml-auto shrink-0 rounded-md border border-border/60 px-1.5 py-0.5 text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          HTML
        </span>
      </div>

      {embedsEnabled ? (
        <iframe
          // `sandbox` with an empty value applies every restriction: no
          // scripts, no same-origin, no forms, no top-level navigation, no
          // popups. This attribute — not the artifact's markup — is what makes
          // untrusted HTML safe to render, so it must never gain a token
          // without a matching threat-model review.
          sandbox=""
          className="block w-full border-0 bg-white"
          height={embedHeight}
          loading="lazy"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          title={label}
        />
      ) : (
        <div className="flex items-start gap-2 px-3 py-3 text-xs text-muted-foreground">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {alt ? `${alt} — ` : ""}
            HTML embeds are off. Turn them on in Settings → Experiments.
          </span>
        </div>
      )}
    </div>
  );
}
