/**
 * ActiveCallWidget.tsx
 * Premium UI for active Audio and Video calls.
 * Displays floating widgets, stats overlays, quality indicators, and camera grid.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Volume2, Video, VideoOff, Wifi, Info, Check, X, Maximize2, Minimize2 } from "lucide-react";
import type { CallType, CallStats } from "@/types/call";

interface Props {
  name: string;
  callType: CallType;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isRemoteVideoEnabled: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;

  // Streams
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  // Upgrades
  incomingUpgradeRequest: boolean;
  onRequestUpgrade: () => void;
  onRespondUpgrade: (accepted: boolean) => void;

  // Stats
  stats: CallStats | null;

  // Sliders
  micGain: number;
  onMicGainChange: (v: number) => void;
  speakerVolume: number;
  onSpeakerVolumeChange: (v: number) => void;
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
  callType,
  isMuted,
  isVideoEnabled,
  isRemoteVideoEnabled,
  onToggleMute,
  onToggleVideo,
  onEndCall,
  remoteAudioRef,
  localStream,
  remoteStream,
  incomingUpgradeRequest,
  onRequestUpgrade,
  onRespondUpgrade,
  stats,
  micGain,
  onMicGainChange,
  speakerVolume,
  onSpeakerVolumeChange,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false); // default to false (compact PIP!)
  const [expanded, setExpanded] = useState(false); // audio hover state
  const [showStatsDetails, setShowStatsDetails] = useState(false);
  const duration = useCallTimer();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Bind local stream reactively (with guard to avoid resetting frames)
  useEffect(() => {
    if (localVideoRef.current && localVideoRef.current.srcObject !== localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Bind remote stream reactively (with guard to avoid resetting frames)
  useEffect(() => {
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Determine signal color
  const getQualityColor = (quality?: CallStats["quality"]) => {
    switch (quality) {
      case "Excellent": return "bg-emerald-500 text-emerald-100";
      case "Good": return "bg-teal-500 text-teal-100";
      case "Fair": return "bg-yellow-500 text-yellow-900";
      case "Weak": return "bg-orange-500 text-orange-100";
      case "Poor": return "bg-red-500 text-red-100";
      default: return "bg-zinc-500 text-zinc-100";
    }
  };

  // 📹 VIDEO CALL LAYOUT (Unified layout swapping smoothly via CSS classes)
  if (callType === "video") {
    return (
      <div className={`
        fixed z-50 transition-all duration-300 ease-in-out overflow-hidden shadow-2xl flex flex-col border border-zinc-800 bg-zinc-900
        ${isExpanded 
          ? "inset-0 m-4 rounded-3xl" 
          : "bottom-4 right-4 w-64 p-3 rounded-2xl"
        }
      `}>
        {/* Header Row */}
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold text-xs truncate leading-tight">{name}</p>
            <p className="text-emerald-400 text-[10px] font-mono tabular-nums leading-none mt-0.5">{duration}</p>
          </div>
          
          <div className="flex items-center gap-1">
            {isExpanded && stats && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-semibold shadow-md mr-1 ${getQualityColor(stats.quality)}`}>
                <Wifi className="h-3.5 w-3.5" />
                <span>{stats.quality}</span>
              </div>
            )}
            
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title={isExpanded ? "Minimize" : "Maximize"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            
            {isExpanded && (
              <button
                onClick={() => setShowStatsDetails((v) => !v)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Connection metrics"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className={`relative flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden rounded-xl ${!isExpanded ? "aspect-video w-full" : ""}`}>
          {isRemoteVideoEnabled && remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-zinc-600">
              <div className={`${isExpanded ? 'h-16 w-16 text-xl' : 'h-8 w-8 text-[10px]'} rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold border border-zinc-700`}>
                {name[0].toUpperCase()}
              </div>
              <span className="text-[10px] font-medium italic">Camera off</span>
            </div>
          )}

          {/* Local Thumbnail PIP (Always mounted, just resized) */}
          <div className={`
            absolute border border-zinc-800 rounded-xl overflow-hidden shadow-md z-10 bg-zinc-900 transition-all duration-300
            ${isExpanded 
              ? "bottom-4 right-4 w-40 aspect-video" 
              : "bottom-1 right-1 w-16 aspect-video"
            }
          `}>
            {isVideoEnabled && localStream ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600">
                <VideoOff className={`${isExpanded ? 'h-4 w-4' : 'h-2.5 w-2.5'}`} />
              </div>
            )}
          </div>

          {/* Metrics Overlay Panel */}
          {isExpanded && showStatsDetails && stats && (
            <div className="absolute top-4 right-4 z-30 w-72 bg-zinc-950/90 backdrop-blur-lg border border-zinc-800 rounded-2xl p-4 text-zinc-300 shadow-2xl flex flex-col gap-2.5 animate-slide-in">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Metrics</p>
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/40">
                  <span className="text-[10px] text-zinc-500 block">Ping (RTT)</span>
                  <span className="text-emerald-400 font-semibold">{stats.rtt}ms</span>
                </div>
                <div className="bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/40">
                  <span className="text-[10px] text-zinc-500 block">Jitter</span>
                  <span className="text-emerald-400 font-semibold">{stats.jitter}ms</span>
                </div>
                <div className="bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/40">
                  <span className="text-[10px] text-zinc-500 block">Packet Loss</span>
                  <span className={`${stats.packetLoss > 2 ? 'text-red-400' : 'text-emerald-400'} font-semibold`}>
                    {stats.packetLoss}%
                  </span>
                </div>
                <div className="bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/40">
                  <span className="text-[10px] text-zinc-500 block">FPS</span>
                  <span className="text-emerald-400 font-semibold">{stats.fps} fps</span>
                </div>
                <div className="bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/40 col-span-2">
                  <span className="text-[10px] text-zinc-500 block">Resolution</span>
                  <span className="text-emerald-400 font-semibold truncate block">{stats.resolution}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls Panel */}
        {isExpanded ? (
          <div className="border-t border-zinc-805 dark:border-zinc-800 mt-3 pt-3 flex flex-col gap-3">
            {/* Sliders */}
            <div className="grid grid-cols-2 gap-4 text-zinc-400 text-[10px] font-medium">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1"><Volume2 className="h-3 w-3" /> Speaker Volume</span>
                  <span className="font-mono text-emerald-400">{Math.round(speakerVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.05"
                  value={speakerVolume}
                  onChange={(e) => onSpeakerVolumeChange(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-1 rounded bg-zinc-800 appearance-none cursor-pointer"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1"><Mic className="h-3 w-3" /> Mic Boost</span>
                  <span className="font-mono text-emerald-400">{Math.round(micGain * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.05"
                  value={micGain}
                  onChange={(e) => onMicGainChange(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-1 rounded bg-zinc-800 appearance-none cursor-pointer"
                />
              </div>
            </div>
            {/* Buttons */}
            <div className="flex justify-center items-center gap-3">
              <button
                onClick={onToggleMute}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-colors cursor-pointer shadow-md ${
                  isMuted
                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                    : "bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-750"
                }`}
              >
                {isMuted ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
              </button>
              <button
                onClick={onToggleVideo}
                className={`p-2.5 rounded-xl flex items-center justify-center transition-colors cursor-pointer shadow-md ${
                  !isVideoEnabled
                    ? "bg-zinc-850 text-zinc-550 border border-zinc-800 hover:bg-zinc-800"
                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                }`}
              >
                {isVideoEnabled ? <Video className="h-4.5 w-4.5" /> : <VideoOff className="h-4.5 w-4.5" />}
              </button>
              <button
                onClick={onEndCall}
                className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors flex items-center gap-2 shadow-md cursor-pointer text-xs"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                <span>Hang Up</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center gap-2 mt-2">
            <button
              onClick={onToggleMute}
              className={`p-1.5 rounded-lg flex-1 flex items-center justify-center transition-colors cursor-pointer text-xs ${
                isMuted
                  ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                  : "bg-zinc-800 text-zinc-350 hover:bg-zinc-700"
              }`}
            >
              {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onToggleVideo}
              className={`p-1.5 rounded-lg flex-1 flex items-center justify-center transition-colors cursor-pointer text-xs ${
                !isVideoEnabled
                  ? "bg-zinc-800 text-zinc-500 hover:bg-zinc-750"
                  : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
              }`}
            >
              {isVideoEnabled ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onEndCall}
              className="p-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white flex-1 flex items-center justify-center cursor-pointer transition-colors"
            >
              <PhoneOff className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // 📞 AUDIO CALL LAYOUT
  return (
    <>
      <div
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        className={`
          fixed bottom-4 right-4 z-50
          bg-zinc-900 dark:bg-zinc-800
          border border-zinc-700 dark:border-zinc-600
          rounded-2xl shadow-2xl
          transition-all duration-300 ease-in-out
          overflow-hidden cursor-pointer
          ${expanded ? "w-64 p-4" : "w-48 p-3"}
        `}
        tabIndex={0}
        role="region"
        aria-label={`Active call with ${name}`}
      >
        {/* Always-visible top row */}
        <div className="flex items-center gap-2.5 min-w-0">
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

          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm truncate leading-tight">{name}</p>
            <p className="text-emerald-400 text-[11px] font-mono tabular-nums">{duration}</p>
          </div>

          {!expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); onEndCall(); }}
              className="h-7 w-7 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
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
                className="w-full accent-emerald-500 h-1 rounded-lg cursor-pointer bg-zinc-750 appearance-none"
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
                className="w-full accent-emerald-500 h-1 rounded-lg cursor-pointer bg-zinc-750 appearance-none"
              />
            </div>

            {/* Mute and End Row */}
            <div className="flex gap-2 w-full">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  isMuted
                    ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                    : "bg-zinc-750 text-zinc-200 hover:bg-zinc-750"
                }`}
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                <span>Mute</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEndCall(); }}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                aria-label="End call"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                <span>End</span>
              </button>
            </div>

            {/* Switch to Video Action */}
            <button
              onClick={(e) => { e.stopPropagation(); onRequestUpgrade(); }}
              className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
            >
              <Video className="h-3.5 w-3.5" />
              <span>Switch to Video</span>
            </button>
          </div>
        )}
      </div>

      {/* RENDER DYNAMIC MODAL PROMPT FOR UPGRADE */}
      {incomingUpgradeRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl flex flex-col gap-4">
            <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
              <Video className="h-6 w-6 animate-pulse" />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-zinc-100 font-semibold text-lg">Switch to Video</h3>
              <p className="text-zinc-400 text-sm">
                <span className="text-emerald-400 font-bold">{name}</span> is requesting to upgrade this call to video.
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onRespondUpgrade(false)}
                className="flex-1 py-2.5 rounded-2xl border border-zinc-850 hover:bg-zinc-850 text-zinc-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                Decline
              </button>
              <button
                onClick={() => onRespondUpgrade(true)}
                className="flex-1 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs transition-colors shadow-lg cursor-pointer"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </>
  );
}
