import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { Layers, Zap, ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMonitor } from "@/lib/queries/monitors";
import {
  listFunnelSteps,
  listEventAssertionsByMonitor,
} from "@/lib/queries/funnel";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
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

// ---------------------------------------------------------------------------
// Status badge variant map
// ---------------------------------------------------------------------------

const STATUS_VARIANT = {
  active: "default",
  passing: "secondary",
  failing: "destructive",
  paused: "outline",
  pending: "outline",
  running: "outline",
  pending_retry: "outline",
  failed: "destructive",
} as const;

// ---------------------------------------------------------------------------
// Page (Server Component)
// ---------------------------------------------------------------------------

export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // Fetch monitor + funnel data in parallel — independent queries.
  const [mon, steps] = await Promise.all([
    getMonitor(db, id, session.user.id),
    listFunnelSteps(db, id),
  ]);

  if (!mon) {
    notFound();
  }

  const assertions = await listEventAssertionsByMonitor(db, id);

  // Build a lookup from funnelStepId → assertions for the step
  const assertionsByStep = new Map<string, typeof assertions>();
  for (const a of assertions) {
    const bucket = assertionsByStep.get(a.funnelStepId) ?? [];
    bucket.push(a);
    assertionsByStep.set(a.funnelStepId, bucket);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ── Back link + header ── */}
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>
        </Button>

        <PageHeader
          title={mon.name}
          description={`Checks every ${mon.intervalMinutes} min · ${mon.url}`}
          actions={
            <Badge variant={STATUS_VARIANT[mon.status]}>
              {mon.status.charAt(0).toUpperCase() + mon.status.slice(1)}
            </Badge>
          }
        />
      </div>

      {/* ── Funnel Steps ── */}
      <Card className="rounded-xl border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="font-display text-xl font-medium flex items-center gap-2">
            <Layers className="size-5 text-muted-foreground" />
            Funnel Steps
          </CardTitle>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No funnel steps recorded yet"
              description="Use the Chrome extension to record your checkout or signup flow — steps will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-muted-foreground text-sm w-16">
                    Order
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Action
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Payload
                  </TableHead>
                  <TableHead className="text-muted-foreground text-sm">
                    Assertions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step) => {
                  const stepAssertions = assertionsByStep.get(step.id) ?? [];
                  return (
                    <TableRow key={step.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {step.stepOrder + 1}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {step.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <pre className="text-xs text-muted-foreground font-mono max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                          {JSON.stringify(step.payload)}
                        </pre>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono tabular-nums text-sm text-muted-foreground">
                          {stepAssertions.length}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Event Assertions ── */}
      <Card className="rounded-xl border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="font-display text-xl font-medium flex items-center gap-2">
            <Zap className="size-5 text-muted-foreground" />
            Event Assertions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assertions.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No event assertions configured"
              description="Add per-step expectations for GA4, Meta Pixel, Google Ads, or Stripe — PixelPulse will verify each one on every synthetic run."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-muted-foreground text-sm">
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
                  const stepIndex =
                    steps.findIndex((s) => s.id === assertion.funnelStepId) + 1;
                  return (
                    <TableRow key={assertion.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {stepIndex > 0 ? stepIndex : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {assertion.platform}
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
