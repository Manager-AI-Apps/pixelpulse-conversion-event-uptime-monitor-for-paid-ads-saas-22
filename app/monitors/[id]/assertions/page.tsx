import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft, Zap } from "lucide-react";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMonitor } from "@/lib/queries/monitors";
import {
  listFunnelSteps,
  listEventAssertionsByMonitor,
} from "@/lib/queries/funnel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/blocks/empty-state";
import { PageHeader } from "@/components/blocks/page-header";

// ---------------------------------------------------------------------------
// Platform badge colours
// ---------------------------------------------------------------------------

const PLATFORM_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ga4: "default",
  meta_browser: "secondary",
  meta_capi: "secondary",
  google_ads: "outline",
  stripe: "outline",
};

const PLATFORM_LABEL: Record<string, string> = {
  ga4: "GA4",
  meta_browser: "Meta Pixel",
  meta_capi: "Meta CAPI",
  google_ads: "Google Ads",
  stripe: "Stripe",
};

// ---------------------------------------------------------------------------
// Page (Server Component — authenticated)
// ---------------------------------------------------------------------------

export default async function AssertionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // Verify ownership — redirect to dashboard if not found or wrong user.
  const mon = await getMonitor(db, id, session.user.id);
  if (!mon) {
    redirect("/dashboard");
  }

  // Fetch steps and assertions in parallel — both independent queries.
  const [steps, assertions] = await Promise.all([
    listFunnelSteps(db, id),
    listEventAssertionsByMonitor(db, id),
  ]);

  // Build step-order lookup for rendering.
  const stepOrderMap = new Map<string, number>(
    steps.map((s) => [s.id, s.stepOrder]),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ── Back link ── */}
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/monitors/${id}`}>
            <ArrowLeft className="size-4" />
            Back to monitor
          </Link>
        </Button>

        <PageHeader
          title="Event Assertions"
          description={`All conversion-event expectations for "${mon.name}"`}
          actions={
            <Badge variant="outline" className="font-mono text-xs">
              {assertions.length} assertion{assertions.length !== 1 ? "s" : ""}
            </Badge>
          }
        />
      </div>

      {/* ── Assertions table ── */}
      <Card className="rounded-xl border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="font-display text-xl font-medium flex items-center gap-2">
            <Zap className="size-5 text-muted-foreground" />
            Assertions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assertions.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No assertions configured yet"
              description="Add per-step event expectations from the monitor detail page — PixelPulse will verify GA4, Meta Pixel (browser + CAPI), Google Ads, and Stripe events on every synthetic run."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-muted-foreground text-sm w-20">
                    Step
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Platform
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Event
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Currency
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Expected Props
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assertions.map((assertion) => {
                  const rawOrder = stepOrderMap.get(assertion.funnelStepId);
                  const stepLabel =
                    rawOrder !== undefined
                      ? String(rawOrder + 1)
                      : "—";

                  const platformLabel =
                    PLATFORM_LABEL[assertion.platform] ?? assertion.platform;
                  const platformVariant =
                    PLATFORM_VARIANT[assertion.platform] ?? "outline";

                  return (
                    <TableRow key={assertion.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {stepLabel}
                      </TableCell>
                      <TableCell>
                        <Badge variant={platformVariant} className="text-xs">
                          {platformLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {assertion.eventName}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {assertion.expectedCurrency ?? "—"}
                      </TableCell>
                      <TableCell>
                        {assertion.expectedProps ? (
                          <pre className="text-xs text-muted-foreground font-mono max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                            {JSON.stringify(assertion.expectedProps)}
                          </pre>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
