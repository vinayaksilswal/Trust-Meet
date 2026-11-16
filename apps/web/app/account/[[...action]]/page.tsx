import { notFound } from "next/navigation";
import { Account, type AccountAction } from "@/components/account";

const actions = ["settings", "login", "register", "recover", "reset", "verify", "resend"] as const;

export default async function AccountPage({ params }: { params: Promise<{ action?: string[] }> }) {
  const { action } = await params;
  const selected = action?.[0] ?? "settings";
  if ((action?.length ?? 0) > 1 || !actions.includes(selected as AccountAction)) notFound();
  return <Account key={selected} action={selected as AccountAction} />;
}
