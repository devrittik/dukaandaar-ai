import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-sm hover:bg-primary-dark focus-visible:ring-primary/30",
  secondary: "bg-surface-green text-primary hover:bg-primary-light/70 focus-visible:ring-primary/20",
  ghost: "bg-transparent text-ink-soft hover:bg-surface-subtle focus-visible:ring-primary/20",
  outline: "border border-line bg-white text-ink hover:bg-surface-subtle focus-visible:ring-primary/20",
  danger: "bg-danger text-white hover:bg-red-700 focus-visible:ring-danger/25",
};
const sizes = { sm: "min-h-9 px-3 text-xs", md: "min-h-10 px-4 text-sm", lg: "min-h-12 px-5 text-sm", icon: "h-10 w-10 p-0" };

export function Button({ variant = "primary", size = "md", loading = false, disabled, className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-55 ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
