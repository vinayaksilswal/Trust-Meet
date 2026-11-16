"use client";

import { useQuery } from "@tanstack/react-query";
import { session } from "@conviya/contracts";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, schema: z.ZodType<T>, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api" + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof result?.detail === "string" ? result.detail : "Conviya is temporarily unavailable.");
  }
  return schema.parse(response.status === 204 ? null : await response.json());
}

export function useAccount() {
  return useQuery({
    queryKey: ["account"],
    retry: false,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      try { return await api("/me", session, undefined, signal); }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
