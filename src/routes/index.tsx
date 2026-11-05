import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import travelImg from "@/assets/card-travel.png";
import cinemaImg from "@/assets/card-cinema.png";
import shoppingImg from "@/assets/card-shopping.png";
import { BirLogo } from "@/components/bir-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bir — trips, cinema and shopping" },
      {
        name: "description",
        content: "Find flights, CinemaPlus sessions and Birmarket deals, or ask the Bir assistant anything.",
      },
      { property: "og:title", content: "Bir — trips, cinema and shopping" },
      { property: "og:description", content: "Flights, movies and shopping with the Bir assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const TOPICS = [
  { label: "Travel", img: travelImg },
  { label: "Cinema", img: cinemaImg },
  { label: "Shopping", img: shoppingImg },
];

function Home() {
  return (
    <div className="flex h-dvh justify-center bg-stage sm:items-center sm:py-6">
      <div className="phone-shell relative flex h-full w-full max-w-[440px] flex-col overflow-hidden sm:h-[min(920px,calc(100dvh-3rem))] sm:rounded-[2.75rem] sm:border sm:border-border">
        <main className="min-h-0 flex-1 overflow-y-auto pb-44">
          <section className="relative px-5 pb-8 pt-5">
            <div className="absolute inset-0 -z-0 bg-gradient-to-b from-primary/30 via-primary/10 to-transparent" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="icon-pill size-11">
                  <BirLogo className="h-[22px] w-[14px] text-primary" />
                </span>
                <p className="text-lg font-semibold">bir</p>
              </div>
              <ThemeToggle />
            </div>
            <div className="relative mt-16 text-center">
              <h1 className="text-4xl font-bold leading-tight tracking-tight">
                Trips, movies and shopping
                <br />
                in one place
              </h1>
              <p className="mt-3 text-muted-foreground">Ask the Bir assistant — it does the searching for you.</p>
              <Link
                to="/chat"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-7 py-3.5 text-base font-semibold text-background transition-opacity hover:opacity-90"
              >
                Open the chat <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </section>

          <section className="grid grid-cols-3 gap-3 px-5">
            {TOPICS.map((t) => (
              <Link key={t.label} to="/chat" className="flex flex-col items-center gap-2">
                <span className="aspect-square w-full overflow-hidden rounded-3xl border border-border bg-card">
                  <img src={t.img} alt="" className="h-full w-full object-cover" />
                </span>
                <span className="font-semibold">{t.label}</span>
              </Link>
            ))}
          </section>

          <section className="px-5 pt-8">
            <h2 className="text-2xl font-bold">For you</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-3xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-primary">Travel</p>
                <p className="mt-1 font-semibold">Cheapest flights from Baku this month</p>
              </div>
              <div className="rounded-3xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-primary">Cinema</p>
                <p className="mt-1 font-semibold">What's on at CinemaPlus tonight</p>
              </div>
            </div>
          </section>
        </main>

        <Link
          to="/chat"
          className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-full border border-border bg-card p-2 pl-6 shadow-lg"
        >
          <span>
            <span className="block font-semibold">Do you need help?</span>
            <span className="block text-sm text-muted-foreground">Ask me anything</span>
          </span>
          <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <MessageCircle className="size-6" />
          </span>
        </Link>
      </div>
    </div>
  );
}
