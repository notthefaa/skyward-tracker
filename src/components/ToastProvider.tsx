"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { CheckCircle, AlertTriangle, XCircle, Info, X } from "lucide-react";

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  isVisible: boolean;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICON_MAP = {
  success: { Icon: CheckCircle, color: "text-[#56B94A]" },
  error: { Icon: XCircle, color: "text-danger" },
  warning: { Icon: AlertTriangle, color: "text-mxOrange" },
  info: { Icon: Info, color: "text-info" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, variant, isVisible: true }]);

    // Auto-dismiss after duration
    const duration = variant === "error" ? 5000 : 3000;
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, isVisible: false } : t));
      // Remove from DOM after fade-out
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, duration);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, isVisible: false } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  const showSuccess = useCallback((msg: string) => showToast(msg, "success"), [showToast]);
  const showError = useCallback((msg: string) => showToast(msg, "error"), [showToast]);
  const showWarning = useCallback((msg: string) => showToast(msg, "warning"), [showToast]);
  const showInfo = useCallback((msg: string) => showToast(msg, "info"), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      <div
        // role="status" + aria-live=polite makes screen readers announce
        // each toast as it appears without interrupting the user's
        // current focus. Errors get role="alert" individually below
        // so they're announced more assertively.
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="fixed left-1/2 -translate-x-1/2 z-[10001] flex flex-col items-center gap-2 pointer-events-none"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 5rem)',
        }}
      >
        {toasts.map(toast => {
          const { Icon, color } = ICON_MAP[toast.variant];
          return (
            <div
              key={toast.id}
              role={toast.variant === 'error' ? 'alert' : undefined}
              className={`pointer-events-auto transition-all duration-300 ${toast.isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
            >
              <div className="bg-[#091F3C] text-white px-5 py-3 rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.3)] flex items-center gap-3 border border-white/10 max-w-sm">
                <Icon size={18} className={`${color} shrink-0`} />
                <span className="font-roboto text-sm font-medium">{toast.message}</span>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="text-gray-400 hover:text-white shrink-0 ml-1"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
