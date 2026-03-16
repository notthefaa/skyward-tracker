import { ReactNode } from "react";

export function PrimaryButton({ children, onClick }: { children: ReactNode, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full bg-navy text-white font-oswald tracking-widest uppercase py-3 px-4 rounded hover:bg-opacity-90 transition-all flex justify-center items-center gap-2 text-sm"
    >
      {children}
    </button>
  );
}

export function AddButton({ children, onClick }: { children: ReactNode, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full border-dashed border-2 border-gray-300 text-navy font-bold py-3 px-4 rounded hover:bg-gray-50 transition-all flex justify-center items-center gap-2 text-sm"
    >
      {children}
    </button>
  );
}