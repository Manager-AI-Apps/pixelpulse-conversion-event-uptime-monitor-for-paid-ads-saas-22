import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Plus } from "lucide-react";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listMonitors } from "@/lib/queries/monitors";
import { MonitorList } from "@/app/_components/monitor-list";
import { PageHeader } from "@/components/blocks/page-header";
import { Button } from "@/components/ui/button";

/**
 * Dashboard page — lists this user's monitors.
 *
 * Renders inside the AppShell (provided by the parent layout).
 * Redirects unauthenticated visitors to /sign-in.
 */
export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const monitors = await listMonitors(db, session.user.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Monitors"
        description="Scheduled synthetic checks for your conversion events."
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/monitors/new">
              <Plus className="size-4" />
              New Monitor
            </Link>
          </Button>
        }
      />

      <MonitorList monitors={monitors} />
    </div>
  );
}
