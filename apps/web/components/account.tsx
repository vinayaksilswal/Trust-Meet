"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { credentials, message, registration, token } from "@conviya/contracts";
import { Field, Notice } from "@conviya/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent } from "react";
import { z } from "zod";
import { api, errorMessage, useAccount } from "@/lib/client";

export type AccountAction = "settings" | "login" | "register" | "recover" | "reset" | "verify" | "resend";

const titles = {
  login: "Sign in", register: "Create an account", recover: "Recover your account",
  reset: "Set a new password", verify: "Verify your email", resend: "Resend verification",
};

export function Account({ action }: { action: AccountAction }) {
  if (action === "settings") return <Settings />;
  return <AccountForm action={action} />;
}

function AccountForm({ action }: { action: Exclude<AccountAction, "settings"> }) {
  const router = useRouter();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (fields: Record<string, FormDataEntryValue>) => {
      switch (action) {
        case "register": return api("/auth/register", message, registration.parse(fields));
        case "login": return api("/auth/login", message, credentials.parse(fields));
        case "recover":
        case "resend": return api("/auth/" + action, message, z.object({ email: z.email() }).parse(fields));
        case "verify":
        case "reset": {
          const proof = token.safeParse(window.location.hash.slice(1));
          if (!proof.success) throw new Error("Open the link from your email to continue.");
          const body = action === "reset" ? { token: proof.data, password: z.string().min(12).max(128).parse(fields.password) } : { token: proof.data };
          const result = await api("/auth/" + action, message, body);
          window.history.replaceState(null, "", window.location.pathname);
          return result;
        }
      }
    },
    onSuccess: async () => {
      if (action === "login") {
        await client.invalidateQueries({ queryKey: ["account"] });
        const next = new URLSearchParams(window.location.search).get("next");
        router.push(next === "connect" ? "/connect" : next === "rooms" ? "/private-rooms" : "/account");
      }
    },
  });
  const requireEmail = !["verify", "reset"].includes(action);
  const requirePassword = ["login", "register", "reset"].includes(action);
  const completed = mutation.isSuccess && action !== "login";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(Object.fromEntries(new FormData(event.currentTarget)));
  }
  return <div className="content-panel form-panel">
    <h1>{titles[action]}</h1>
    {action === "register" && <p>Conviya is for adults aged 18 and older.</p>}
    {action === "verify" && !completed && <p>Confirm that this email address belongs to you.</p>}
    {completed ? <Notice>{mutation.data.message}</Notice> : <form className="form-stack" onSubmit={submit}>
      {action === "register" && <Field label="Display name" name="display_name" autoComplete="nickname" minLength={2} maxLength={60} required />}
      {requireEmail && <Field label="Email address" name="email" type="email" autoComplete="email" maxLength={254} required />}
      {requirePassword && <Field label="Password" name="password" type="password" autoComplete={action === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required />}
      {mutation.isError && <Notice error>{mutation.error instanceof z.ZodError ? mutation.error.issues[0]?.message : mutation.error.message}</Notice>}
      <button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? "Please wait…" : titles[action]}</button>
    </form>}
    <div className="form-links">
      {action !== "login" && <Link href="/account/login">Back to sign in</Link>}
      {action === "login" && <><Link href="/account/register">Create an account</Link><Link href="/account/recover">Forgot password?</Link><Link href="/account/resend">Resend verification</Link></>}
      {action === "register" && <Link href="/account/resend">Resend verification</Link>}
    </div>
  </div>;
}

function Settings() {
  const account = useAccount();
  const client = useQueryClient();
  const router = useRouter();
  const age = useMutation({
    mutationFn: (birthDate: string) => api("/eligibility", z.object({ eligible: z.boolean() }), { birth_date: birthDate }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["account"] }),
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", z.null(), {}),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["conversation"] });
      client.setQueryData(["account"], null);
      router.push("/");
    },
  });
  if (account.isPending) return <Notice>Loading your account…</Notice>;
  if (account.isError) return <Notice error>{errorMessage(account.error)} <button onClick={() => account.refetch()}>Try again</button></Notice>;
  if (!account.data) return <div className="content-panel"><h1>Account</h1><p>Sign in to manage your account.</p><Link className="button button-primary" href="/account/login">Sign in</Link></div>;
  return <article className="content-panel form-panel">
    <h1>Your account</h1>
    <p>{account.data.display_name} · {account.data.email}</p>
    <h2>Age eligibility</h2>
    {account.data.eligible ? <Notice>Adult eligibility confirmed for local testing.</Notice> :
      age.data?.eligible === false ? <Notice error>This account is ineligible for conversations.</Notice> :
      account.data.age_check_available ? <form className="form-stack" onSubmit={event => {
        event.preventDefault();
        age.mutate(String(new FormData(event.currentTarget).get("birth_date")));
      }}>
        <p>Enter a test date of birth to check whether this account can use conversations. Only the result is stored.</p>
        <Field label="Date of birth" name="birth_date" type="date" required />
        <button className="button button-primary" disabled={age.isPending}>Check eligibility</button>
      </form> : <Notice>Age assurance is currently unavailable.</Notice>}
    {age.isError && <Notice error>{errorMessage(age.error)}</Notice>}
    {logout.isError && <Notice error>{errorMessage(logout.error)}</Notice>}
    <div className="form-links">{account.data.eligible && <Link href="/connect">Open Random Connect</Link>}
    <button className="button button-outline" disabled={logout.isPending} onClick={() => logout.mutate()}>Sign out</button></div>
  </article>;
}
