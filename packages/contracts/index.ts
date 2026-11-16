import { z } from "zod";

export const mode = z.enum(["text", "audio", "video"]);
export type Mode = z.infer<typeof mode>;
export const session = z.object({
  id: z.uuid(), display_name: z.string(), email: z.email(),
  eligible: z.boolean(), age_check_available: z.boolean(),
  online_age_check_available: z.boolean().default(false),
  conversations_enabled: z.boolean(), matchmaking_enabled: z.boolean(), private_rooms_enabled: z.boolean(),
});
export const conversation = z.object({
  id: z.uuid(), mode, state: z.enum(["invited", "active", "ended"]),
  expires_at: z.string(), consented: z.boolean(), partner: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversation>;
export const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const invite = z.object({ id: z.uuid(), token });
export const media = z.object({ url: z.string(), token: z.string() });
export const message = z.object({ message: z.string() });
export const credentials = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});
export const registration = credentials.extend({
  display_name: z.string().trim().min(2, "Enter at least two characters for your name.").max(60),
});

export const roomSummary = z.object({
  id: z.uuid(), title: z.string(), mode, starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }), capacity: z.number().int(),
  state: z.enum(["waiting", "approved", "left", "removed"]), locked: z.boolean(), host: z.boolean(), closed: z.boolean(),
});
export const privateRoom = roomSummary.extend({
  participants: z.array(z.object({ id: z.uuid(), name: z.string(), state: z.enum(["waiting", "approved"]) })),
});
