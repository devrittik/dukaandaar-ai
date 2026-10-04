import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; padded?: boolean; }
export function Card({ children, className = "", padded = true, ...props }: CardProps) {
  return <div className={`rounded-card border border-line/80 bg-white shadow-card ${padded ? "p-5 sm:p-6" : ""} ${className}`} {...props}>{children}</div>;
}
