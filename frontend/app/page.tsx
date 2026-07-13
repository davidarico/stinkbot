import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* subtle top-center glow */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 50% -5%, oklch(0.80 0.09 235 / 0.12) 0%, transparent 70%)",
        }}
      />

      {/* Nav */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-border/60">
        <span className="text-sm font-semibold tracking-[0.12em] uppercase text-foreground/80">
          Stinkwolf
        </span>
        <nav className="flex items-center gap-6">
          <Link href="/roles" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Roles
          </Link>
          <Link href="/archives" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Archives
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <main className="flex flex-col items-center justify-center flex-1 px-6 text-center">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.18em] uppercase text-primary mb-6">
            Stinky Solutions LLC
          </p>
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight text-foreground mb-5 leading-[1.08]">
            Game Master<br />Console
          </h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-lg mx-auto leading-relaxed">
            Role assignment, live vote tracking, and phase management for Werewolf games - integrated directly with Discord.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/roles">
              <Button size="lg" className="px-8 font-medium">
                View All Roles
              </Button>
            </Link>
            <Link href="/archives">
              <Button size="lg" variant="outline" className="px-8 font-medium">
                Message Archives
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Feature strip */}
      <footer className="border-t border-border/60 px-8 py-8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              label: "Role Management",
              description: "Build game compositions from a full role library. Set charges, win conditions, and custom names.",
            },
            {
              label: "Live Vote Tracking",
              description: "Watch votes accumulate in real-time during the day phase. Configurable hang threshold.",
            },
            {
              label: "Phase Control",
              description: "Night and day phases driven by the Discord bot. The UI reflects state instantly.",
            },
          ].map((f) => (
            <div key={f.label} className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{f.label}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </footer>
    </div>
  )
}
