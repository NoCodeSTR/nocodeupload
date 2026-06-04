import Link from "next/link";
import { Shield, Zap, Folder, Camera, Video } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-ink-200 dark:border-ink-700">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/">
            <BrandLogo />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">
              Log in
            </Link>
            <Link href="/signup" className="btn-primary">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <p className="mb-4 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">
          Built for Short-Term Rental hosts
        </p>
        <h1 className="font-display text-5xl font-bold leading-tight tracking-tight md:text-6xl">
          Collect files into Google Drive
          <br />
          <span className="text-brand">without the back-and-forth.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-500">
          Create a public upload link in seconds. Your guests, cleaners, and owners drop photos and
          videos straight into the right Drive folder — no Google account, no email attachments, no
          chaos.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="btn-primary px-6 py-3 text-base">
            Create your first link
          </Link>
          <Link href="#how-it-works" className="btn-secondary px-6 py-3 text-base">
            How it works
          </Link>
        </div>
      </section>

      {/* Use cases */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Video, title: "Guest Damage Videos", body: "Send a link with the booking confirmation — guests upload check-out videos straight to that property's folder." },
            { icon: Camera, title: "Cleaner Before & After", body: "Each cleaning gets its own link. Cleaners upload from their phone in 30 seconds." },
            { icon: Folder, title: "Owner Shared Docs", body: "Tax docs, insurance, vendor invoices — one link per owner, organized forever." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="card">
              <Icon className="mb-3 h-6 w-6 text-brand" />
              <h3 className="mb-1 font-display text-lg font-semibold">{title}</h3>
              <p className="text-sm text-ink-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-900">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h2 className="mb-12 text-center font-display text-3xl font-bold">How it works</h2>
          <ol className="space-y-8">
            {[
              { step: "1", title: "Connect Google Drive", body: "Sign in with email, then connect your Google account. We never see your existing files." },
              { step: "2", title: "Pick a folder, name the link", body: "Use the Google Picker to choose any folder. Add a name like 'Guest Videos — 123 Beach Rd'." },
              { step: "3", title: "Share the link", body: "Copy the public URL or embed the widget on your site. Visitors upload without signing in." },
              { step: "4", title: "Files land in Drive", body: "Uploads go straight to your folder via Google's resumable API. Multi-GB videos work fine." },
            ].map(({ step, title, body }) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
                  {step}
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold">{title}</h3>
                  <p className="text-ink-500">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust strip */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Shield, title: "Tokens stay server-side", body: "Your Google OAuth credentials never reach a browser. Encrypted at rest." },
            { icon: Zap, title: "Large videos, no problem", body: "Files upload in resumable chunks, so multi-gigabyte videos send reliably without timing out." },
            { icon: Folder, title: "Least-privilege access", body: "We only see files our app created. Your existing Drive stays private." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="mb-3 h-5 w-5 text-brand" />
              <h3 className="mb-1 font-display font-semibold">{title}</h3>
              <p className="text-sm text-ink-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-ink-200 dark:border-ink-700">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-sm text-ink-500">
          <div className="flex items-center justify-center gap-4">
            <Link href="/privacy" className="hover:text-ink-900 dark:hover:text-ink-50">Privacy</Link>
            <Link href="/terms" className="hover:text-ink-900 dark:hover:text-ink-50">Terms</Link>
          </div>
          <p className="mt-3">NoCode Upload — files, simplified.</p>
        </div>
      </footer>
    </main>
  );
}
