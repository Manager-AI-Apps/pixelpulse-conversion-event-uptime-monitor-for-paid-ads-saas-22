import Link from "next/link";
import { ActivitySquare, Bell, LayoutDashboard, MousePointerClick } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeatureGrid, type Feature } from "@/components/blocks/feature-grid";
import { Hero } from "@/components/blocks/hero";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES: Feature[] = [
  {
    icon: <MousePointerClick className="size-6" />,
    title: "Visual Funnel Recorder",
    description:
      "Click-record your signup or checkout path once with our Chrome extension. PixelPulse replays it on schedule with a headless browser — no GTM expertise required.",
  },
  {
    icon: <ActivitySquare className="size-6" />,
    title: "Per-Step Event Assertions",
    description:
      "Verify every conversion event — GA4, Meta Pixel (browser + CAPI), Google Ads linker, and Stripe Purchase — including event name, currency, value, and dedup key.",
  },
  {
    icon: <Bell className="size-6" />,
    title: "Diagnostic Slack Alerts",
    description:
      "Get pinged with a precise diagnosis: 'Purchase fired without value', 'duplicate via gtag + GTM', or 'CAPI silent fail' — not a vague 'check failed' noise.",
  },
  {
    icon: <LayoutDashboard className="size-6" />,
    title: "Uptime Dashboard",
    description:
      "Track the health of every conversion event across all your funnels in one place. Spot regressions the moment they start — before ad spend goes to waste.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-base font-semibold tracking-tight">
          PixelPulse
        </span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Sign up</Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <Hero
        eyebrow={<Badge variant="secondary">Conversion event uptime monitoring</Badge>}
        title="Stop burning ad spend on a broken pixel."
        subtitle="PixelPulse simulates your signup and checkout funnel every 15 minutes and alerts you in Slack the moment a GA4, Meta Pixel, Google Ads, or Stripe conversion event stops firing."
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/sign-up">Start monitoring free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </>
        }
      />

      <FeatureGrid features={FEATURES} />
    </main>
  );
}
