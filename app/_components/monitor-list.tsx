"use client";

/**
 * MonitorList — renders the user's monitors in a DataTable.
 *
 * Accepts monitors as props (fetched by the parent Server Component) and
 * handles the empty state with a friendly prompt to create one.
 */

import { Activity } from "lucide-react";

import { DataTable, type Column } from "@/components/blocks/data-table";
import { EmptyState } from "@/components/blocks/empty-state";
import { Badge } from "@/components/ui/badge";
import type { monitor } from "@/lib/db/schema";

type Monitor = typeof monitor.$inferSelect;

const STATUS_VARIANT: Record<
  Monitor["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  passing: "secondary",
  failing: "destructive",
  paused: "outline",
  pending: "outline",
};

const COLUMNS: Column<Monitor>[] = [
  {
    key: "name",
    header: "Monitor",
    cell: (row) => (
      <span className="font-medium text-foreground">{row.name}</span>
    ),
  },
  {
    key: "url",
    header: "Site URL",
    cell: (row) => (
      <span className="font-mono text-sm text-muted-foreground">{row.url}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => (
      <Badge variant={STATUS_VARIANT[row.status]}>
        {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
      </Badge>
    ),
  },
  {
    key: "interval",
    header: "Check every",
    numeric: true,
    cell: (row) => `${row.intervalMinutes}m`,
  },
];

export function MonitorList({ monitors }: { monitors: Monitor[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={monitors}
      getRowKey={(row) => row.id}
      empty={
        <EmptyState
          icon={Activity}
          title="No monitors set up yet"
          description="Add your first monitor to start checking your conversion events."
        />
      }
    />
  );
}
