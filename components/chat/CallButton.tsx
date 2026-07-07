/**
 * CallButton.tsx
 * Phone icon in the chat header. Clicking opens a user picker popover.
 * Disabled while a call is in progress.
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatUser } from "@/types/chat";
import type { CallStatus, CallType } from "@/types/call";

interface Props {
  users: ChatUser[];
  callStatus: CallStatus;
  onCall: (targetSocketId: string, targetUsername: string, type: CallType) => void;
  onEndCall: () => void;
  mode: "audio" | "video";
}

export default function CallButton({ users, callStatus, onCall, onEndCall, mode }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Active call — show red hang-up button
  if (callStatus === "active" || callStatus === "calling") {
    if (mode === "video") return null;
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={onEndCall}
        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer animate-pulse"
        title="End call"
        aria-label="End call"
      >
        <PhoneOff className="h-4 w-4" />
      </Button>
    );
  }

  const handleAction = () => {
    if (users.length === 1) {
      onCall(users[0].id, users[0].username, mode);
    } else if (users.length > 1) {
      setOpen((v) => !v);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleAction}
        className={`h-8 w-8 cursor-pointer transition-colors ${
          users.length === 0
            ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
            : "text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400"
        }`}
        title={users.length === 0 ? "No other users online" : `Start a ${mode} call`}
        aria-label={`Start a ${mode} call`}
        disabled={users.length === 0}
      >
        {mode === "audio" ? <Phone className="h-4 w-4" /> : <Video className="h-4 w-4" />}
      </Button>

      {open && (
        <div className="absolute right-0 top-10 z-50 min-w-[160px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-1.5 flex flex-col gap-0.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-2 pt-1 pb-0.5">
            Select User
          </p>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => { onCall(u.id, u.username, mode); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm text-left transition-colors cursor-pointer text-zinc-700 dark:text-zinc-300"
            >
              <span className="h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                {u.username[0].toUpperCase()}
              </span>
              <span className="truncate font-medium flex-1">{u.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
