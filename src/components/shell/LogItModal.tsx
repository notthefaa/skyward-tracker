"use client";

import { X, Share, Copy } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const COMPANION_URL = process.env.NEXT_PUBLIC_COMPANION_URL || "https://skyward-logit.vercel.app/";

export default function LogItModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showSuccess, showInfo } = useToast();
  if (!open) return null;

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(COMPANION_URL)
        .then(() => showSuccess("Link copied! Open your phone's browser, paste the link, and Add to Home Screen."))
        .catch(() => showInfo("Couldn't copy automatically — copy this link: " + COMPANION_URL));
    } else {
      showInfo("Couldn't copy automatically — copy this link: " + COMPANION_URL);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[10000] overflow-y-auto animate-fade-in"
      style={{ overscrollBehavior: 'contain' }}
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-label="Install Log It companion app"
          className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 border-t-8 border-info animate-slide-up relative"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 text-gray-400 hover:text-danger"
          >
            <X size={24}/>
          </button>
          <h3 className="font-oswald text-2xl font-bold uppercase tracking-widest text-navy mb-4">Install Log It</h3>
          <p className="text-sm text-gray-600 font-roboto mb-4 leading-relaxed">
            Companion app for logging from the ramp — flights, VOR, oil, tire, squawks. Works without signal and flushes when you&apos;re back in range.
          </p>
          <ol className="text-left text-sm text-gray-600 font-roboto mb-8 space-y-2 max-w-xs mx-auto list-decimal pl-4">
            <li>Tap below to copy the link.</li>
            <li>Open it in your phone&apos;s browser.</li>
            <li>Use the Share menu <Share size={14} className="inline text-blue-500 mb-1"/> to add it to your home screen.</li>
          </ol>
          <button
            onClick={handleCopy}
            className="w-full bg-info text-white font-oswald text-xl font-bold uppercase tracking-widest py-4 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            <Copy size={20} /> Copy App Link
          </button>
        </div>
      </div>
    </div>
  );
}
