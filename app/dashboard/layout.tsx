import { AppShell } from "@/components/app-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { LayoutDashboard, MonitorCheck } from "lucide-react";

const NAV = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard className="size-4" />,
  },
  {
    title: "Monitors",
    href: "/monitors",
    icon: <MonitorCheck className="size-4" />,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      appName="PixelPulse"
      nav={NAV}
      footer={<SignOutButton />}
    >
      {children}
    </AppShell>
  );
}
