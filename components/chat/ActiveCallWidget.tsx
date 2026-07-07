/**
 * ActiveCallWidget.tsx
 * Floating mini pill shown during an active voice call.
 * Default: compact pill with name + duration timer.
 * Hover / tap: expands to show Mute and End Call buttons.
 *
 * Also renders the hidden <audio> element for the remote stream.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";

interface Props {
  name: string;
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  micGain: number;
  onMicGainChange: (v: number) => void;
  speakerVolume: number;
  onSpeakerVolumeChange: (v: number) => void;
  networkQuality: "good" | "okay" | "poor";
}

function useCallTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function ActiveCallWidget({
  name,
  isMuted,
  onToggleMute,
  onEndCall,
  remoteAudioRef,
  micGain,
  onMicGainChange,
  speakerVolume,
  onSpeakerVolumeChange,
  networkQuality,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const duration = useCallTimer();
  const widgetRef = useRef<HTMLDivElement>(null);

  // Drag states & refs
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPosRef = useRef({ x: 0, y: 0 });
  const dragDistanceRef = useRef(0);

  const handleDragStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    dragStartRef.current = { x: clientX, y: clientY };
    initialPosRef.current = { ...position };
    dragDistanceRef.current = 0;
  };

  const handleDragMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    dragDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
    
    setPosition({
      x: initialPosRef.current.x + dx,
      y: initialPosRef.current.y + dy,
    });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    
    if (typeof window === "undefined" || !widgetRef.current) return;

    const rect = widgetRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const margin = 16;
    const W = rect.width;
    const H = rect.height;

    // Calculate distance to all 4 corners of the viewport
    const distances = [
      { corner: "tl", d: centerX * centerX + centerY * centerY },
      { corner: "tr", d: (centerX - vw) * (centerX - vw) + centerY * centerY },
      { corner: "bl", d: centerX * centerX + (centerY - vh) * (centerY - vh) },
      { corner: "br", d: (centerX - vw) * (centerX - vw) + (centerY - vh) * (centerY - vh) },
    ];
    
    distances.sort((a, b) => a.d - b.d);
    const nearest = distances[0].corner;

    let targetX = 0;
    let targetY = 0;

    if (nearest === "tl") {
      targetX = -(vw - W - 2 * margin);
      targetY = -(vh - H - 2 * margin);
    } else if (nearest === "tr") {
      targetX = 0;
      targetY = -(vh - H - 2 * margin);
    } else if (nearest === "bl") {
      targetX = -(vw - W - 2 * margin);
      targetY = 0;
    } else if (nearest === "br") {
      targetX = 0;
      targetY = 0;
    }

    setPosition({ x: targetX, y: targetY });
  };

  // Bind drag event listeners to document for fluid high-speed drags
  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const onMouseUp = () => handleDragEnd();
    const onTouchEnd = () => handleDragEnd();

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchend", onTouchEnd);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDragging, position]);

  // Collapse widget on click/tap outside
  useEffect(() => {
    if (!expanded) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [expanded]);

  // Distinguish simple tap/click from dragging movements
  const handleClick = (e: React.MouseEvent) => {
    if (dragDistanceRef.current > 6) {
      e.stopPropagation();
      return;
    }
    setExpanded((prev) => !prev);
  };

  return (
    <>
      <div
        ref={widgetRef}
        onClick={handleClick}
        onMouseDown={(e) => {
          // Only initiate drag on left mouse click
          if (e.button === 0) handleDragStart(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transition: isDragging
            ? "none"
            : "transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.12), width 0.3s cubic-bezier(0.16, 1, 0.3, 1), padding 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          touchAction: "none",
        }}
        className={`
          fixed bottom-4 right-4 z-50
          bg-zinc-900 dark:bg-zinc-800
          border border-zinc-700 dark:border-zinc-600
          rounded-2xl shadow-2xl
          overflow-hidden select-none
          ${isDragging ? "cursor-grabbing" : "cursor-grab"}
          ${expanded ? "w-64 p-4" : "w-48 p-3"}
        `}
        tabIndex={0}
        role="region"
        aria-label={`Active call with ${name}`}
      >
        {/* Always-visible top row */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Animated waveform bars */}
          <div className="flex items-end gap-[2px] h-5 shrink-0">
            {[0.4, 0.8, 0.5, 1, 0.6].map((h, i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-emerald-400"
                style={{
                  height: `${h * 20}px`,
                  animation: `wave ${0.5 + i * 0.1}s ease-in-out ${i * 0.07}s infinite alternate`,
                }}
              />
            ))}
          </div>

          <div className="flex-1 min-w-0 flex items-center justify-between gap-1.5">
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate leading-tight">{name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-emerald-400 text-[11px] font-mono tabular-nums">{duration}</span>
                <span className="inline-flex items-center gap-1 shrink-0">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    networkQuality === "good" ? "bg-emerald-500 animate-pulse" :
                    networkQuality === "okay" ? "bg-amber-500" : "bg-red-500 animate-ping"
                  }`} />
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${
                    networkQuality === "good" ? "text-emerald-400" :
                    networkQuality === "okay" ? "text-amber-400" : "text-red-400"
                  }`}>
                    {networkQuality}
                  </span>
                </span>
              </div>
            </div>
            
            <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded leading-none shrink-0 ${
              networkQuality === "good"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : networkQuality === "okay"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "bg-red-500/25 text-red-400 border border-red-500/40 animate-pulse"
            }`}>
              {networkQuality === "poor" ? "LOW" : "HD"}
            </span>
          </div>

          {/* Quick end-call button always visible */}
          {!expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); onEndCall(); }}
              className="h-7 w-7 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shrink-0 transition-colors"
              aria-label="End call"
            >
              <PhoneOff className="h-3.5 w-3.5 text-white" />
            </button>
          )}
        </div>

        {/* Expanded controls */}
        {expanded && (
          <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-zinc-700/60 w-full text-zinc-300">
            {/* Speaker Volume Slider */}
            <div className="flex flex-col gap-1 w-full">
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                <span className="flex items-center gap-1">
                  <Volume2 className="h-3.5 w-3.5 text-zinc-500" /> Speaker Volume
                </span>
                <span className="font-mono text-emerald-400">{Math.round(speakerVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={speakerVolume}
                onChange={(e) => onSpeakerVolumeChange(parseFloat(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                className="w-full accent-emerald-500 h-1 rounded-lg cursor-pointer bg-zinc-700 appearance-none"
              />
            </div>

            {/* Mic Gain Slider */}
            <div className="flex flex-col gap-1 w-full">
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400">
                <span className="flex items-center gap-1">
                  <Mic className="h-3.5 w-3.5 text-zinc-500" /> Mic Gain (Boost)
                </span>
                <span className="font-mono text-emerald-400">{Math.round(micGain * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={micGain}
                onChange={(e) => onMicGainChange(parseFloat(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                className="w-full accent-emerald-500 h-1 rounded-lg cursor-pointer bg-zinc-700 appearance-none"
              />
            </div>

            <div className="flex gap-2 w-full mt-1">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  isMuted
                    ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                    : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                }`}
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEndCall(); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                aria-label="End call"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                End
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Keyframe for waveform bars */}
      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </>
  );
}
