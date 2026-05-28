/**
 * Authenticated dashboard shell.
 * requireUser() throws a redirect to /login if there's no session, so any
 * page rendered inside this layout can assume a signed-in user.
 *
 * Layout: sidebar + main column. The topbar lives inside individual pages
 * because each page needs to set its own title.
 */
import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Forces redirect to /login if not signed in.
  await requireUser();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
