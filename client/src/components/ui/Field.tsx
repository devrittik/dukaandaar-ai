import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const fieldBase = "w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none transition placeholder:text-muted/75 focus:border-primary/55 focus:ring-4 focus:ring-primary/10";
export function Field({ label, hint, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-soft">{label}</span><input className={`${fieldBase} h-11 ${className}`} {...props} />{hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}</label>;
}
export function SelectField({ label, children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-soft">{label}</span><select className={`${fieldBase} h-11 ${className}`} {...props}>{children}</select></label>;
}
export function TextAreaField({ label, className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-soft">{label}</span><textarea className={`${fieldBase} min-h-24 py-3 ${className}`} {...props} /></label>;
}
