import { Code2, FileJson2, Zap } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/blocks/page-header";
import { CopyButton } from "@/app/snippet/_components/copy-button";

// ---------------------------------------------------------------------------
// Snippet strings — kept as constants so tests can assert on their content
// ---------------------------------------------------------------------------

export const SCRIPT_TAG_SNIPPET =
  `<script src="https://app.pixelpulse.dev/snippet.js"\n  data-monitor-id="YOUR_MONITOR_ID"\n  async></script>`;

export const CONFIG_FILE_EXAMPLE = `{
  "monitorId": "YOUR_MONITOR_ID",
  "endpoints": {
    "beacon": "https://app.pixelpulse.dev/api/beacon"
  }
}`;

export const CONFIG_FILE_NAME = "pixelpulse.config.json";

// ---------------------------------------------------------------------------
// Page (Server Component — no auth required, public install guide)
// ---------------------------------------------------------------------------

export default function SnippetPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* ── Top nav ── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-base font-semibold tracking-tight">
          PixelPulse
        </span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get started free</Link>
          </Button>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        <PageHeader
          title="Install the PixelPulse snippet"
          description="One line of code connects your site to a PixelPulse monitor. Place it before the closing </body> tag on every page you want to track."
        />

        {/* ── Step 1: Copy the script tag ── */}
        <Card className="rounded-xl border bg-card shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="font-display text-xl font-medium flex items-center gap-2">
              <Code2 className="size-5 text-muted-foreground" />
              1. Paste the{" "}
              <Badge variant="secondary" className="font-mono text-xs">
                &lt;script&gt;
              </Badge>{" "}
              tag
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Replace{" "}
              <code className="font-mono text-foreground bg-muted px-1 rounded">
                YOUR_MONITOR_ID
              </code>{" "}
              with the ID shown in your monitor&apos;s settings page.
            </p>

            <div className="relative rounded-lg border bg-muted/50 p-4">
              <pre className="overflow-x-auto text-sm font-mono text-foreground whitespace-pre-wrap break-all">
                {SCRIPT_TAG_SNIPPET}
              </pre>
              <div className="mt-3 flex justify-end">
                <CopyButton text={SCRIPT_TAG_SNIPPET} label="Copy tag" />
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              The <code className="font-mono text-foreground bg-muted px-1 rounded">data-monitor-id</code> attribute
              tells PixelPulse which monitor this page belongs to. You can find
              your monitor ID on the{" "}
              <Link href="/dashboard" className="underline hover:text-foreground transition-colors">
                dashboard
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        {/* ── Step 2: Optional config file ── */}
        <Card className="rounded-xl border bg-card shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="font-display text-xl font-medium flex items-center gap-2">
              <FileJson2 className="size-5 text-muted-foreground" />
              2. Optional: use{" "}
              <code className="font-mono text-sm">{CONFIG_FILE_NAME}</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If you prefer not to embed the monitor ID directly in each page,
              place a{" "}
              <code className="font-mono text-foreground bg-muted px-1 rounded">
                {CONFIG_FILE_NAME}
              </code>{" "}
              file at the root of your site and omit the{" "}
              <code className="font-mono text-foreground bg-muted px-1 rounded">
                data-monitor-id
              </code>{" "}
              attribute. The snippet will fetch the config automatically.
            </p>

            <div className="relative rounded-lg border bg-muted/50 p-4">
              <pre className="overflow-x-auto text-sm font-mono text-foreground whitespace-pre-wrap">
                {CONFIG_FILE_EXAMPLE}
              </pre>
              <div className="mt-3 flex justify-end">
                <CopyButton text={CONFIG_FILE_EXAMPLE} label="Copy config" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Step 3: Verify ── */}
        <Card className="rounded-xl border bg-card shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="font-display text-xl font-medium flex items-center gap-2">
              <Zap className="size-5 text-muted-foreground" />
              3. Verify the connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Once the snippet is live, open your browser&apos;s Network panel and
              look for a request to{" "}
              <code className="font-mono text-foreground bg-muted px-1 rounded">
                /api/beacon
              </code>
              . A{" "}
              <Badge variant="secondary" className="font-mono text-xs">
                204
              </Badge>{" "}
              response confirms the snippet is connected.
            </p>

            <p className="text-sm text-muted-foreground">
              Head to your{" "}
              <Link href="/dashboard" className="underline hover:text-foreground transition-colors">
                dashboard
              </Link>{" "}
              to see the first synthetic run trigger within 15 minutes.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
