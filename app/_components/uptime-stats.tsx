"use client";

/**
 * UptimeStats — StatCard row for 7d/30d uptime rates + ad-spend-at-risk callout.
 *
 * Receives pre-fetched UptimeStat[] arrays from the parent Server Component.
 * Computes aggregate uptime % by averaging across all assertion uptimes.
 */

import { Activity, AlertTriangle, TrendingUp } from "lucide-react";

import { StatCard } from "@/components/blocks/stat-card";
import { Badge } from "@/components/ui/badge";
import type { UptimeStat } from "@/lib/queries/uptime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Aggregate uptime across all assertions: average of individual uptimePct. */
function aggregateUptime(stats: UptimeStat[]): number {
  if (stats.length === 0) return 0;
  const sum = stats.reduce((acc, s) => acc + s.uptimePct, 0);
  return Math.round(sum / stats.length);
}

/**
 * Find the most recent failure diagnosis among a set of stats.
 * Returns null when everything is passing.
 */
function lastFailureDiagnosis(
  stats: UptimeStat[],
): UptimeStat["lastDiagnosis"] | null {
  const failing = stats.filter((s) => s.lastDiagnosis !== "ok");
  if (failing.length === 0) return null;
  return failing[0]!.lastDiagnosis;
}

// Human-readable labels for diagnosis codes.
const DIAGNOSIS_LABELS: Record<string, string> = {
  purchase_without_value: "Purchase fired without value",
  duplicate_via_gtag_gtm: "Duplicate via gtag + GTM",
  capi_silent_fail: "CAPI silent fail",
  ga4_property_mismatch: "GA4 property mismatch",
  event_not_fired: "Event not fired",
  value_mismatch: "Value mismatch",
  currency_mismatch: "Currency mismatch",
  dedup_key_missing: "Dedup key missing",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface UptimeStatsProps {
  stats7d: UptimeStat[];
  stats30d: UptimeStat[];
}

export function UptimeStats({ stats7d, stats30d }: UptimeStatsProps) {
  const pct7d = aggregateUptime(stats7d);
  const pct30d = aggregateUptime(stats30d);

  // Use the 7d window for the last-failure diagnosis (more recent signal).
  const lastDiagnosis = lastFailureDiagnosis(stats7d);

  return (
    <div className="space-y-4">
      {/* ── Uptime StatCards ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="7-day Uptime"
          value={`${pct7d}%`}
          icon={Activity}
          hint={stats7d.length === 0 ? "No runs in last 7 days" : undefined}
        />
        <StatCard
          label="30-day Uptime"
          value={`${pct30d}%`}
          icon={TrendingUp}
          hint={stats30d.length === 0 ? "No runs in last 30 days" : undefined}
        />
      </div>

      {/* ── Last failure diagnosis ── */}
      {lastDiagnosis && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="text-sm font-medium text-foreground">
            Last failure:
          </span>
          <Badge variant="destructive" className="font-mono text-xs">
            {DIAGNOSIS_LABELS[lastDiagnosis] ?? lastDiagnosis}
          </Badge>
        </div>
      )}

      {/* ── Ad-spend-at-risk static callout ── */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium text-foreground">
          Ad-spend at risk
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          ~25–30% of spend is at risk per industry benchmarks when conversion
          events stop firing silently. PixelPulse detects breakage within 15
          minutes so you stop bleeding budget.
        </p>
      </div>
    </div>
  );
}
