/**
 * IncomingCallToast.tsx
 * Slide-in incoming call notification with Accept / Reject buttons.
 * Plays calm.mp3 ringtone (started by useWebRTC, stopped on accept/reject).
 */
"use client";

import { Phone, PhoneOff } from "lucide-react";

interface Props {
  callerName: string;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallToast({ callerName, onAccept, onReject }: Props) {
  return (
    <div
      role="alertdialog"
      aria-label={`Incoming call from ${callerName}`}
      className="fixed bottom-4 right-4 z-50 w-80 animate-slide-in"
    >
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        {/* Pulsing green top bar */}
        <div className="h-1 w-full bg-emerald-500 animate-pulse" />

        <div className="p-4">
          {/* Caller avatar + info */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-lg font-bold shadow-lg">
                {callerName[0].toUpperCase()}
              </div>
              {/* Ripple rings */}
              <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60" />
            </div>
            <div>
              <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Incoming Call</p>
              <p className="font-bold text-zinc-900 dark:text-zinc-100 text-lg leading-tight">{callerName}</p>
            </div>
          </div>

          {/* Accept / Reject */}
          <div className="flex gap-3">
            <button
              onClick={onReject}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 font-semibold text-sm transition-colors cursor-pointer"
              aria-label="Reject call"
            >
              <PhoneOff className="h-4 w-4" />
              Decline
            </button>
            <button
              onClick={onAccept}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors cursor-pointer shadow-lg"
              aria-label="Accept call"
            >
              <Phone className="h-4 w-4" />
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
