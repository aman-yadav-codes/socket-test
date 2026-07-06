/**
 * OutgoingCallIndicator.tsx
 * Small slide-in toast shown to the caller while waiting for the other party to pick up.
 */
"use client";

import { PhoneOff } from "lucide-react";

interface Props {
  name: string;
  onCancel: () => void;
}

export default function OutgoingCallIndicator({ name, onCancel }: Props) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 animate-slide-in">
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <div className="h-1 w-full bg-emerald-500" style={{ animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div className="p-4 flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-bold">
              {name[0].toUpperCase()}
            </div>
            <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-50" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">Calling…</p>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{name}</p>
          </div>
          <button
            onClick={onCancel}
            className="h-9 w-9 rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Cancel call"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
