"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({
  lang,
  labels,
}: {
  lang: string;
  labels: {
    email: string;
    password: string;
    submit: string;
    submitting: string;
    invalidCredentials: string;
  };
}) {
  const [state, action, pending] = useActionState<LoginActionState, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={action} className="mt-6 space-y-5">
      <input type="hidden" name="lang" value={lang} />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
          {labels.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
          {labels.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-red-700">
          {labels.invalidCredentials}
        </p>
      )}
      <SubmitButton
        disabled={pending}
        className="w-full rounded-md bg-navy-900 px-4 py-2 font-medium text-white hover:bg-navy-800 disabled:opacity-60"
      >
        {pending ? labels.submitting : labels.submit}
      </SubmitButton>
    </form>
  );
}
