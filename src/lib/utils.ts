import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert a string into a URL-friendly slug.
 * Removes invalid characters and collapses whitespace to hyphens.
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // collapse whitespace
    .replace(/[^a-z0-9\-]/g, '') // remove invalid chars
    .replace(/-+/g, '-') // collapse dashes
    .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

/**
 * Sanitize an email string coming from user input.
 * - Trims whitespace
 * - Removes surrounding quotes/backticks
 * - Removes zero-width/invisible unicode characters
 * - Removes internal whitespace (users sometimes paste with spaces)
 */
export function sanitizeEmail(input: string): string {
  if (!input) return '';
  let s = String(input);
  // Trim surrounding whitespace
  s = s.trim();
  // Remove zero-width and invisible characters
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  // Remove surrounding quotes or backticks
  s = s.replace(/^["'`\u2018\u2019\u201C\u201D]+|["'`\u2018\u2019\u201C\u201D]+$/g, '');
  // Collapse internal whitespace
  s = s.replace(/\s+/g, '');
  return s;
}
