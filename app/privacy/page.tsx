import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = {
  title: "Privacy Policy — NoCode Upload",
  description: "How NoCode Upload collects, uses, and protects your data, including Google user data.",
};

const UPDATED = "July 2026";
const CONTACT = "support@nocodeupload.com";

export default function PrivacyPage() {
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
        <h1 className="font-display text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-500">Last updated: {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-ink-700 dark:text-ink-200">
          <section className="space-y-3">
            <p>
              NoCode Upload (&quot;NoCode Upload,&quot; &quot;we,&quot; &quot;us&quot;) lets people create public
              upload links that deliver files into a connected cloud storage folder (such as
              Google Drive). This policy explains what we collect, how we use it, and the
              choices you have. By using NoCode Upload you agree to this policy.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">Information we collect</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li><strong>Account information.</strong> Your email address and authentication credentials, managed by our authentication provider.</li>
              <li><strong>Connected Google account.</strong> When you connect Google Drive, we receive your Google account email, basic profile, and OAuth tokens that authorize uploads to folders you choose.</li>
              <li><strong>Upload destinations.</strong> The Drive folder you select for each upload link (folder ID and name) and your link settings.</li>
              <li><strong>Upload metadata.</strong> For each uploaded file: file name, size, type, the resulting Drive file ID, and a timestamp.</li>
              <li><strong>Visitor-provided details.</strong> Any name, email, message, or custom fields an uploader submits with a file, plus a one-way hashed form of the uploader&apos;s IP address used for abuse prevention.</li>
              <li><strong>Usage and log data.</strong> Standard server logs and diagnostic information.</li>
            </ul>
            <p>
              We do <strong>not</strong> store the uploaded files themselves — files are transferred directly
              into your connected storage provider.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">How we use Google user data</h2>
            <p>
              We request the minimum Google Drive permission needed:{" "}
              <code className="rounded bg-ink-100 px-1.5 py-0.5 text-sm dark:bg-ink-900">drive.file</code>.
              This grants access only to files our app creates and to the specific folder you
              select via the Google Picker. We use it solely to upload files submitted through
              your links into that folder. <strong>We do not read, view, or index your other
              Google Drive files.</strong>
            </p>
            <p className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm dark:border-ink-700 dark:bg-ink-900">
              NoCode Upload&apos;s use and transfer of information received from Google APIs to any
              other app will adhere to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
            <p>Specifically, information received from Google APIs:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>is used only to provide and improve the upload features you actively use;</li>
              <li>
                is never transferred to others except as needed to provide the service, to comply
                with applicable law, or as part of a merger or acquisition with appropriate notice;
              </li>
              <li>is never used for advertising purposes; and</li>
              <li>
                is never read by humans unless we have your explicit consent for specific items, it
                is necessary for security purposes (such as investigating abuse) or to comply with
                the law, or the data has been aggregated and anonymized for internal operations.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">How we use your information</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Operate the service — create links, transfer uploads into your storage, and show you what was received.</li>
              <li>Send you notifications you enable (e.g. an email when someone uploads).</li>
              <li>Prevent abuse, enforce limits, and keep the service secure.</li>
              <li>Provide support and improve the product.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">How we store and protect data</h2>
            <p>
              OAuth tokens are encrypted at rest. Access to your records is restricted by
              row-level security so you can only reach your own data. Public upload pages never
              expose your folder, your storage account, or other people&apos;s uploads.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">Sharing</h2>
            <p>
              We do not sell your data. We share it only with service providers that operate the
              product on our behalf — our hosting platform, database/auth provider, email
              delivery provider, and Google (for Drive access) — and where required by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">Retention and deletion</h2>
            <p>
              You can disconnect a storage provider or delete an upload link at any time from
              your dashboard, which removes the associated tokens and records. To delete your
              account and associated data, contact us at {CONTACT}. Disconnecting also revokes
              our access to your Google account; you can additionally remove access at{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                your Google account permissions
              </a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">Children</h2>
            <p>NoCode Upload is not directed to children under 13, and we do not knowingly collect their data.</p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">Changes</h2>
            <p>We may update this policy and will revise the date above when we do.</p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-50">Contact</h2>
            <p>Questions? Email us at {CONTACT}.</p>
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
