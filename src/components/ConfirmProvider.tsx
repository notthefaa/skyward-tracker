"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useModalScrollLock } from "@/hooks/useModalScrollLock";
import { PrimaryButton } from "@/components/AppButtons";

type ConfirmVariant = "default" | "danger";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  useModalScrollLock(!!pending);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const close = useCallback((value: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    current.resolve(value);
    setPending(null);
  }, []);

  const variant = pending?.variant ?? "default";
  const isDanger = variant === "danger";
  const accentBorder = isDanger ? "border-danger" : "border-navy";
  const accentIconBg = isDanger ? "bg-danger/10" : "bg-navy/5";
  const accentIconColor = isDanger ? "text-danger" : "text-navy";
  const confirmBtnClass = isDanger
    ? "flex-[2] bg-danger border-2 border-danger text-white font-oswald text-lg font-bold uppercase tracking-widest py-3 rounded hover:bg-opacity-90 active:scale-95 transition-all shadow-md"
    : "";

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[10050] overflow-y-auto bg-black/70 animate-fade-in"
          style={{ overscrollBehavior: 'contain' }}
          onClick={() => close(false)}
        >
          <div className="flex min-h-full items-center justify-center p-4">
          <div
            className={`bg-white rounded shadow-2xl w-full max-w-sm p-6 border-t-4 ${accentBorder} animate-slide-up`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
          >
            <div className="flex flex-col items-center text-center">
              <div className={`${accentIconBg} p-3 rounded-full mb-4`}>
                <AlertTriangle size={28} className={accentIconColor} />
              </div>
              <h2
                id="confirm-title"
                className="font-oswald text-xl font-bold uppercase tracking-widest text-navy mb-3"
              >
                {pending.title}
              </h2>
              <p
                id="confirm-message"
                className="text-sm text-gray-600 font-roboto leading-relaxed mb-6"
              >
                {pending.message}
              </p>
              <div className="flex w-full gap-3">
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="flex-1 border-2 border-gray-200 text-gray-600 font-oswald text-lg font-bold uppercase tracking-widest py-3 rounded hover:bg-gray-50 active:scale-95 transition-all"
                >
                  {pending.cancelText ?? "Cancel"}
                </button>
                {isDanger ? (
                  <button
                    type="button"
                    onClick={() => close(true)}
                    className={confirmBtnClass}
                  >
                    {pending.confirmText ?? "Confirm"}
                  </button>
                ) : (
                  <div className="flex-[2]">
                    <PrimaryButton onClick={() => close(true)}>
                      {pending.confirmText ?? "Confirm"}
                    </PrimaryButton>
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx.confirm;
}
