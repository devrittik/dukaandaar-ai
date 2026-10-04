import type { ReactNode } from "react";

export type BadgeTone = "green" | "amber" | "red" | "gray" | "blue";
const tones: Record<BadgeTone, string> = {
  green: "bg-success-light text-primary",
  amber: "bg-amber-light text-amber",
  red: "bg-danger-light text-danger",
  gray: "bg-surface-subtle text-ink-soft",
  blue: "bg-blue-light text-blue",
};
export function Badge({ children, tone = "gray", dot = false, className = "" }: { children: ReactNode; tone?: BadgeTone; dot?: boolean; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${tones[tone]} ${className}`}>{dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}{children}</span>;
}
