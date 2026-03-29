"use client";

import { useEffect, useState } from "react";
import { CheckCircle, X } from "lucide-react";

interface ToastProps {
  message: string;
  show: boolean;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({ message, show, onDismiss, duration = 3000 }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300); // Wait for fade-out before removing
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onDismiss]);

  if (!show && !isVisible) return null;

  return (
    <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[10001] transition-all duration-300 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
      <div className="bg-[#091F3C] text-white px-5 py-3 rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.3)] flex items-center gap-3 border border-white/10">
        <CheckCircle size={18} className="text-[#56B94A] shrink-0" />
        <span className="font-roboto text-sm font-medium">{message}</span>
        <button onClick={() => { setIsVisible(false); setTimeout(onDismiss, 300); }} className="text-gray-400 hover:text-white shrink-0 ml-1">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
