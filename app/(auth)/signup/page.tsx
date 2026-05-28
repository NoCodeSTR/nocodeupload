import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { signUp } from "./actions";

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <AuthForm mode="signup" signUp={signUp} />
    </Suspense>
  );
}

function AuthFormSkeleton() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-2 h-7 w-48 animate-pulse rounded bg-ink-100 dark:bg-ink-900" />
      <div className="mb-8 h-4 w-64 animate-pulse rounded bg-ink-100 dark:bg-ink-900" />
      <div className="space-y-4">
        <div className="h-10 animate-pulse rounded bg-ink-100 dark:bg-ink-900" />
        <div className="h-10 animate-pulse rounded bg-ink-100 dark:bg-ink-900" />
        <div className="h-10 animate-pulse rounded bg-ink-100 dark:bg-ink-900" />
      </div>
    </div>
  );
}
