import { z } from "zod";

export const displayName = z.string().trim().min(2).max(32);
export const instagram = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ""))
  .refine((value) => value === "" || /^[A-Za-z0-9._]{1,30}$/.test(value), "invalid handle");
export const bio = z.string().trim().max(280);

export const registerInput = z.object({
  displayName,
  instagram,
  accept: z.literal(true),
  termsVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
});

export const profileInput = z.object({
  displayName,
  instagram,
  bio,
  handlePublic: z.boolean(),
  listed: z.boolean(),
  videoConsent: z.boolean().optional(),
});

export const localEmail = z.object({
  email: z.email().max(160),
});

export const localVerify = z.object({
  email: z.email().max(160),
  code: z.string().regex(/^\d{6}$/),
});
