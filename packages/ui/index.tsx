"use client";

import * as Label from "@radix-ui/react-label";
import { useId, type ComponentProps, type ReactNode } from "react";

export function Field({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  const id = useId();
  return <div className="field">
    <Label.Root htmlFor={id}>{label}</Label.Root>
    <input {...props} id={id} />
  </div>;
}

export function Notice({ children, error }: { children: ReactNode; error?: boolean }) {
  return <div className={error ? "notice notice-error" : "notice"} role={error ? "alert" : "status"}>{children}</div>;
}
