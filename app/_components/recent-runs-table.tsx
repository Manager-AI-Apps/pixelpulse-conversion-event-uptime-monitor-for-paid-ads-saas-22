"use client";

/**
 * RecentRunsTable — DataTable for the last N check_runs.
 *
 * Accepts pre-fetched RecentRun[] from the parent Server Component and
 * renders a typed DataTable with status badge + diagnosis summary columns.
 */

import { Clock } from "lucide-react";

import { DataTable, type Column } from "@/components/blocks/data-table";
import { EmptyState } from "@/components/blocks/empty-state";
import { Badge } from "@/components/ui/badge";
import type { RecentRun } from "@/lib/queries/uptime";

// ---------------------------------------------------------------------------
// Diagnosis labels
// ---------------------------------------------------------------------------

const DIAGNOSIS_LABELS: Record<string, string> = {
  ok: "OK",
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
// Status badge variant
// ---------------------------------------------------------------------------

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: "default",
  passing: "secondary",
  failing: "destructive",
  paused: "outline",
  pending: "outline",
  running: "outline",
  pending_retry: "outline",
  failed: "destructive",
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS: Column<RecentRun>[] = [
  {
    key: "startedAt",
    header: "When",
    cell: (row) => (
      <span className="font-mono tabular-nums text-sm text-muted-foreground">
        {row.startedAt.toLocaleString()}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => (
      <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>
        {row.status.charAt(0).toUpperCase() + row.status.slice(1).replace("_", " ")}
      </Badge>
    ),
  },
  {
    key: "diagnosisSummary",
    header: "Diagnosis",
    cell: (row) =>
      row.diagnosisCode ? (
        <span className="text-sm text-muted-foreground">
          {DIAGNOSIS_LABELS[row.diagnosisCode] ?? row.diagnosisCode}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecentRunsTable({ runs }: { runs: RecentRun[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={runs}
      getRowKey={(row) => row.id}
      empty={
        <EmptyState
          icon={Clock}
          title="No runs yet"
          description="PixelPulse will record each synthetic run here. Check back after the first scheduled check."
        />
      }
    />
  );
}
