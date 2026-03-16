import { ReactNode } from "react";

export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode, onClick?: () => void, disabled?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-navy text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function AddButton({ children, onClick }: { children: ReactNode, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full border-dashed border-2 border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 active:scale-95 transition-all duration-150 ease-out flex justify-center items-center gap-2 text-sm"
    >
      {children}
    </button>
  );
}