"use client";

/**
 * Dashboard sidebar — nav between Links / Settings.
 * Highlights the current section via usePathname.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Link2, Settings } from "lucide-react";
import clsx from "clsx";
import { BrandLogo } from "@/components/brand-logo";

const NAV = [
  { href: "/dashboard", label: "Upload Links", icon: Link2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-ink-200 bg-white px-4 py-6 dark:border-ink-700 dark:bg-ink-950 md:flex">
      <Link href="/dashboard" className="mb-8 px-2">
        <BrandLogo imgClassName="h-7 w-auto" />
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
                  : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
