import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ children, className = "", showClose = true }: { children: ReactNode; className?: string; showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-ink/35 backdrop-blur-[3px]" />
      <DialogPrimitive.Content className={`dialog-content fixed left-1/2 top-1/2 z-50 max-h-[min(92vh,850px)] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-line bg-white p-6 shadow-float outline-none sm:p-7 ${className}`}>
        {children}
        {showClose ? <DialogPrimitive.Close className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-surface-subtle hover:text-ink" aria-label="Close dialog"><X size={18} /></DialogPrimitive.Close> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <DialogPrimitive.Title className={`font-display text-xl font-bold tracking-tight text-ink ${className}`}>{children}</DialogPrimitive.Title>;
}
export function DialogDescription({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <DialogPrimitive.Description className={`mt-1 text-sm leading-6 text-muted ${className}`}>{children}</DialogPrimitive.Description>;
}
