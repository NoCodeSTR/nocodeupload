"use client";

/**
 * Shared auth form for login + signup.
 *
 * Supports two modes:
 *  - "login"  — email + password, plus a toggle to "send me a magic link"
 *  - "signup" — email + password (no magic-link toggle; signup always goes
 *               through password to keep the flow simple for MVP)
 *
 * Server actions are passed in as props so the same component can render
 * for both flows without coupling to either action's URL.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Mode = "login" | "signup";

interface AuthFormProps {
  mode: Mode;
  /** Server action that takes FormData and either redirects or returns an error string */
  signInWithPassword?: (formData: FormData) => Promise<{ error?: string } | void>;
  signUp?: (formData: FormData) => Promise<{ error?: string } | void>;
  sendMagicLink?: (formData: FormData) => Promise<{ error?: string; sent?: boolean } | void>;
}

export function AuthForm({ mode, signInWithPassword, signUp, sendMagicLink }: AuthFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [useMagicLink, setUseMagicLink] = useState(false);
  const searchParams = useSearchParams();
  const message = searchParams?.get("message");

  function handleSubmit(formData: FormData) {
    setError(null);
    setMagicLinkSent(false);
    startTransition(async () => {
      const next = searchParams?.get("next");
      if (next) formData.set("next", next);
      let result: { error?: string; sent?: boolean } | void = undefined;
      if (useMagicLink && sendMagicLink) {
        result = await sendMagicLink(formData);
        if (result && "sent" in result && result.sent) setMagicLinkSent(true);
      } else if (mode === "login" && signInWithPassword) {
        result = await signInWithPassword(formData);
      } else if (mode === "signup" && signUp) {
        result = await signUp(formData);
      }
      if (result && "error" in result && result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-2 font-display text-2xl font-bold">
        {mode === "login" ? "Log in to NoCode Upload" : "Create your account"}
      </h1>
      <p className="mb-8 text-sm text-ink-500">
        {mode === "login"
          ? "Welcome back. Sign in to manage your upload links."
          : "Free to start. No credit card needed."}
      </p>

      {message && (
        <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:border-brand-900 dark:bg-brand-900/30 dark:text-brand-100">
          {message}
        </div>
      )}

      {magicLinkSent ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-900/30 dark:text-green-100">
          Check your email for a sign-in link.
        </div>
      ) : (
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="label mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              placeholder="you@example.com"
            />
          </div>

          {!useMagicLink && (
            <div>
              <label className="label mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={8}
                className="input"
                placeholder={mode === "signup" ? "8+ characters" : "••••••••"}
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={isPending}>
            {isPending
              ? "…"
              : useMagicLink
                ? "Send magic link"
                : mode === "login"
                  ? "Log in"
                  : "Create account"}
          </button>

          {mode === "login" && sendMagicLink && (
            <button
              type="button"
              onClick={() => setUseMagicLink((v) => !v)}
              className="text-sm text-brand hover:underline"
            >
              {useMagicLink ? "Use password instead" : "Email me a magic link instead"}
            </button>
          )}
        </form>
      )}

      <div className="mt-8 border-t border-ink-200 pt-6 text-center text-sm text-ink-500 dark:border-ink-700">
        {mode === "login" ? (
          <>
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-brand hover:underline">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">
              Log in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
