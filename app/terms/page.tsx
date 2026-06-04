import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = {
  title: "Terms of Service — NoCode Upload",
  description: "The terms governing your use of NoCode Upload.",
};

const UPDATED = "June 2026";
const CONTACT = "support@nocodeupload.com";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-ink-900 dark:bg-ink-950 dark:text-ink-50">
      <header className="border-b border-ink-200 dark:border-ink-700">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/"><BrandLogo /></Link>
          <Link href="/" className="text-sm text-ink-500 hover:text-ink-900 dark:hover:text-ink-50">
            Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold">Terms of Service</h1>
        <p className="mt-2 text-sm text-ink-500">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-700 dark:text-ink-200">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">1. Acceptance</h2>
            <p>
              By creating an account or using NoCode Upload (the &quot;Service&quot;), you agree to these
              Terms. If you don&apos;t agree, don&apos;t use the Service. You must be at least 18 and able
              to form a binding contract.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">2. What the Service does</h2>
            <p>
              NoCode Upload lets you create public upload links that deliver files into a cloud
              storage folder you connect (such as Google Drive). Uploaded files are transferred
              into your storage provider; we do not store the files ourselves.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">3. Your account</h2>
            <p>
              You&apos;re responsible for your account credentials and for activity under your
              account. Keep your login secure and notify us of any unauthorized use.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">4. Acceptable use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Collect or distribute unlawful, infringing, or harmful content, or malware.</li>
              <li>Violate the privacy or rights of others, or applicable laws.</li>
              <li>Abuse, overload, probe, or attempt to circumvent the Service&apos;s limits or security.</li>
              <li>Violate the terms of any connected provider, including the Google Drive and Google API terms.</li>
            </ul>
            <p>
              You are responsible for the content collected through your links and for having any
              necessary rights and consents to collect it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">5. Your content and storage</h2>
            <p>
              Files uploaded through your links go to your connected storage account, and you
              control them there. You grant us only the limited, technical permissions needed to
              perform those transfers on your behalf, as described in our{" "}
              <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">6. Availability and changes</h2>
            <p>
              We may modify, suspend, or discontinue features at any time. We aim for high
              availability but the Service is provided without a guaranteed uptime.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">7. Disclaimers</h2>
            <p>
              The Service is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any
              kind to the fullest extent permitted by law. We do not warrant that the Service will
              be uninterrupted, error-free, or secure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">8. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, NoCode Upload will not be liable for any
              indirect, incidental, special, consequential, or punitive damages, or for lost data
              or profits, arising from your use of the Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">9. Termination</h2>
            <p>
              You may stop using the Service and delete your account at any time. We may suspend
              or terminate access that violates these Terms or that we reasonably believe is
              harmful to the Service or others.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">10. Contact</h2>
            <p>Questions about these Terms? Email {CONTACT}.</p>
          </section>
        </div>
      </main>

      <footer className="border-t border-ink-200 dark:border-ink-700">
        <div className="mx-auto max-w-3xl px-6 py-8 text-center text-sm text-ink-500">
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="hover:underline">Terms</Link>
          <p className="mt-2">NoCode Upload</p>
        </div>
      </footer>
    </div>
  );
}
