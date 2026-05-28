import Link from "next/link";
import { Upload } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink-200 dark:border-ink-700">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
            <Upload className="h-6 w-6 text-brand" />
            NoCode Upload
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-16">{children}</main>
    </div>
  );
}
