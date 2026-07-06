/**
 * useWebRTC.ts
 * Manages a 1-to-1 voice call using WebRTC, with Socket.IO as the signaling channel.
 *
 * It requests studio-quality 48kHz HD audio constraints, applies noise suppression
 * and echo cancellation, and rewrites SDP profiles to force Opus codec configuration
 * with a high-fidelity 128kbps Constant Bit Rate (CBR) channel in "audio" mode.
 *
 * To avoid disabling the browser's hardware Echo Cancellation and Noise Gate, the
 * local microphone stream is transmitted unprocessed. Mic Gain boosts are communicated
 * over the signaling socket and applied on the receiving side using the Web Audio API
 * along with the speaker volume and a 3-stage Vocal EQ DSP.
 */
"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { ChatSocket } from "@/lib/chatSocket";
import type { CallStatus, IncomingCallData } from "@/types/call";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export interface UseWebRTCOptions {
  socket: ChatSocket | null;
  socketId: string;
  username: string;
}

export interface UseWebRTCReturn {
  callStatus: CallStatus;
  incomingCall: IncomingCallData | null;
  isMuted: boolean;
  callTargetName: string;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  startCall: (targetSocketId: string, targetUsername: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;

  // Sliders
  micGain: number;
  setMicGain: (v: number) => void;
  speakerVolume: number;
  setSpeakerVolume: (v: number) => void;
}

// ── Studio Quality Media Constraints ─────────────────────────────────────────
const HD_AUDIO_CONSTRAINTS = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  sampleRate: { ideal: 48000 },
  sampleSize: { ideal: 16 },
  channelCount: { ideal: 1 }, // Mono mono is best for voice quality/noise-cancellation
};

// ── SDP Opus High-Fidelity Booster ───────────────────────────────────────────
// Directs Opus to run in high-fidelity full-frequency (48kHz) mode at 128kbps Constant Bit Rate
function boostAudioBitrate(sdp: string): string {
  let lines = sdp.split("\r\n");
  let opusPayloadType: string | null = null;

  // Find Opus payload ID (typically 111)
  for (const line of lines) {
    if (line.includes("opus/48000")) {
      const match = line.match(/a=rtpmap:(\d+)/);
      if (match) {
        opusPayloadType = match[1];
        break;
      }
    }
  }

  if (opusPayloadType) {
    lines = lines.map((line) => {
      if (line.startsWith(`a=fmtp:${opusPayloadType}`)) {
        // Enforce high audio quality parameters:
        // - maxaveragebitrate=128000 (128kbps)
        // - maxplaybackrate=48000 & sprop-maxcapturerate=48000 (full audio bandwidth)
        // - stereo=1 & sprop-stereo=1 (enable stereo rendering)
        // - useinbandfec=1 (forward error correction)
        // - cbr=1 (constant bit rate mode)
        // - application=audio (hi-fi sound optimization instead of aggressive voip compression)
        if (!line.includes("maxaveragebitrate")) {
          return `${line};maxaveragebitrate=128000;maxplaybackrate=48000;sprop-maxcapturerate=48000;stereo=1;sprop-stereo=1;useinbandfec=1;cbr=1;application=audio`;
        }
      }
      return line;
    });
  }

  return lines.join("\r\n");
}

// Play synthetic professional descending beep on disconnect
const playDisconnectBeep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch (e) {
    console.error("Failed to play disconnect beep:", e);
  }
};

export function useWebRTC({ socket, socketId, username }: UseWebRTCOptions): UseWebRTCReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callTargetName, setCallTargetName] = useState("");

  // Volume & mic gain adjustments (default 100% gain = 1.0)
  const [micGain, setMicGain] = useState(1.0);
  const [speakerVolume, setSpeakerVolume] = useState(1.0);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const callTargetIdRef = useRef<string>("");
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const callStatusRef = useRef<CallStatus>("idle");

  // Web Audio Context & Gain Nodes refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const speakerGainNodeRef = useRef<GainNode | null>(null);

  // Sync state refs to prevent stale closure bugs in callbacks
  const speakerVolumeRef = useRef(speakerVolume);
  const remoteMicGainRef = useRef(1.0);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Recalculates combined gain: Speaker Volume * Remote Mic Gain (boost)
  const updateSpeakerVolume = useCallback(() => {
    if (speakerGainNodeRef.current && audioContextRef.current) {
      const combinedGain = speakerVolumeRef.current * remoteMicGainRef.current;
      speakerGainNodeRef.current.gain.setValueAtTime(combinedGain, audioContextRef.current.currentTime);
    }
  }, []);

  useEffect(() => {
    speakerVolumeRef.current = speakerVolume;
    updateSpeakerVolume();
  }, [speakerVolume, updateSpeakerVolume]);

  // Notify other party when local mic gain setting changes
  useEffect(() => {
    if (socket && callTargetIdRef.current) {
      socket.emit("mic-gain-change", { to: callTargetIdRef.current, gain: micGain });
    }
  }, [micGain, socket]);

  // Preload incoming call ringtone
  useEffect(() => {
    if (typeof window === "undefined") return;
    ringtoneRef.current = new Audio("/sounds/calm.mp3");
    ringtoneRef.current.loop = true;
    return () => {
      ringtoneRef.current?.pause();
      ringtoneRef.current = null;
    };
  }, []);

  // ── Web Audio Node Initializer ───────────────────────────────────────────
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  // ── Connection Helpers ───────────────────────────────────────────────────

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate && socket && callTargetIdRef.current) {
        socket.emit("ice-candidate", { to: callTargetIdRef.current, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];

      // Mute raw HTML audio element to prevent double audio playback
      // since we route it through AudioContext destination below
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.volume = 0;
        remoteAudioRef.current.play().catch(() => {});
      }

      try {
        const ctx = getAudioContext();
        const source = ctx.createMediaStreamSource(remoteStream);

        // ── Real-time Vocal EQ Pipeline ──
        // 1. Highpass filter (< 80Hz) to cut background AC rumblings, bumps and low humming noise
        const lowCut = ctx.createBiquadFilter();
        lowCut.type = "highpass";
        lowCut.frequency.setValueAtTime(80, ctx.currentTime);

        // 2. Peaking filter to add warmth/richness to vocals (boost +3.5dB around 200Hz)
        const warmth = ctx.createBiquadFilter();
        warmth.type = "peaking";
        warmth.frequency.setValueAtTime(200, ctx.currentTime);
        warmth.Q.setValueAtTime(1.0, ctx.currentTime);
        warmth.gain.setValueAtTime(3.5, ctx.currentTime);

        // 3. Peaking filter to boost presence/clarity/intelligibility (boost +4.0dB around 3000Hz)
        const clarity = ctx.createBiquadFilter();
        clarity.type = "peaking";
        clarity.frequency.setValueAtTime(3000, ctx.currentTime);
        clarity.Q.setValueAtTime(1.2, ctx.currentTime);
        clarity.gain.setValueAtTime(4.0, ctx.currentTime);

        // 4. Volume Gain Node connected to output
        const gainNode = ctx.createGain();
        const initialGain = speakerVolumeRef.current * remoteMicGainRef.current;
        gainNode.gain.setValueAtTime(initialGain, ctx.currentTime);
        speakerGainNodeRef.current = gainNode;

        // Route: Source -> LowCut (Highpass) -> Warmth (200Hz) -> Clarity (3kHz) -> Volume -> Speakers
        source.connect(lowCut);
        lowCut.connect(warmth);
        warmth.connect(clarity);
        clarity.connect(gainNode);
        gainNode.connect(ctx.destination);
      } catch (err) {
        console.error("Failed to build Web Audio graph for incoming stream:", err);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        playDisconnectBeep();
        cleanup();
      }
    };

    return pc;
  }, [socket, getAudioContext]);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    // Reset gain nodes and AudioContext
    speakerGainNodeRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    pendingCandidates.current = [];
    callTargetIdRef.current = "";
    remoteMicGainRef.current = 1.0;
    setCallStatus("idle");
    setIncomingCall(null);
    setCallTargetName("");
    setIsMuted(false);
  }, []);

  // ── WebRTC Actions ───────────────────────────────────────────────────────

  const startCall = useCallback(async (targetSocketId: string, targetUsername: string) => {
    if (!socket || callStatus !== "idle") return;

    try {
      // Request high definition audio constraints
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: HD_AUDIO_CONSTRAINTS,
        video: false,
      });
      localStreamRef.current = rawStream;

      const pc = createPeerConnection();
      peerRef.current = pc;

      // Add tracks directly to keep browser hardware Echo Cancellation and Noise Gate active.
      // Modifying microphone tracks via Web Audio Destination node disables AEC in most browsers.
      rawStream.getTracks().forEach((t) => pc.addTrack(t, rawStream));

      const offer = await pc.createOffer();
      // Boost Opus audio bitrate in SDP offer
      const boostedOfferSdp = boostAudioBitrate(offer.sdp || "");
      const boostedOffer = { type: offer.type, sdp: boostedOfferSdp };

      await pc.setLocalDescription(boostedOffer);

      callTargetIdRef.current = targetSocketId;
      setCallTargetName(targetUsername);
      setCallStatus("calling");

      socket.emit("call-user", { to: targetSocketId, offer: boostedOffer });
    } catch (err) {
      console.error("Failed to start call:", err);
      cleanup();
    }
  }, [socket, callStatus, createPeerConnection, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !socket) return;

    ringtoneRef.current?.pause();

    try {
      // Request high definition audio constraints
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: HD_AUDIO_CONSTRAINTS,
        video: false,
      });
      localStreamRef.current = rawStream;

      const pc = createPeerConnection();
      peerRef.current = pc;

      // Add tracks directly to keep browser hardware Echo Cancellation active
      rawStream.getTracks().forEach((t) => pc.addTrack(t, rawStream));

      // Boost Opus audio bitrate in incoming SDP offer before setting
      const boostedOfferSdp = boostAudioBitrate(incomingCall.offer.sdp || "");
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: boostedOfferSdp }));

      for (const c of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      pendingCandidates.current = [];

      const answer = await pc.createAnswer();
      // Boost Opus audio bitrate in local SDP answer
      const boostedAnswerSdp = boostAudioBitrate(answer.sdp || "");
      const boostedAnswer = { type: answer.type, sdp: boostedAnswerSdp };

      await pc.setLocalDescription(boostedAnswer);

      callTargetIdRef.current = incomingCall.fromSocketId;
      setCallTargetName(incomingCall.fromUsername);
      setCallStatus("active");
      setIncomingCall(null);

      socket.emit("call-answer", { to: incomingCall.fromSocketId, answer: boostedAnswer });
      // Send initial mic gain setting to peer
      socket.emit("mic-gain-change", { to: incomingCall.fromSocketId, gain: micGain });
    } catch (err) {
      console.error("Failed to accept call:", err);
      cleanup();
    }
  }, [incomingCall, socket, createPeerConnection, micGain, cleanup]);

  const rejectCall = useCallback(() => {
    if (!incomingCall || !socket) return;
    socket.emit("call-rejected", { to: incomingCall.fromSocketId });
    playDisconnectBeep();
    cleanup();
  }, [incomingCall, socket, cleanup]);

  const endCall = useCallback(() => {
    if (socket && callTargetIdRef.current) {
      socket.emit("call-ended", { to: callTargetIdRef.current });
    }
    playDisconnectBeep();
    cleanup();
  }, [socket, cleanup]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((v) => !v);
  }, []);

  // ── Socket event listeners ───────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = ({ from, fromUsername, offer }: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit }) => {
      if (callStatusRef.current !== "idle") {
        socket.emit("call-rejected", { to: from });
        return;
      }
      setIncomingCall({ fromSocketId: from, fromUsername, offer });
      setCallStatus("ringing");
      ringtoneRef.current?.play().catch(() => {});
    };

    const onCallAnswered = async ({ answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
      if (!peerRef.current) return;
      try {
        // Boost Opus audio bitrate in remote answer before setting
        const boostedAnswerSdp = boostAudioBitrate(answer.sdp || "");
        await peerRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: boostedAnswerSdp }));
        for (const c of pendingCandidates.current) {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        pendingCandidates.current = [];
        setCallStatus("active");
        // Send initial mic gain setting to peer
        socket.emit("mic-gain-change", { to: callTargetIdRef.current, gain: micGain });
      } catch (err) {
        console.error("Failed to process call answer:", err);
        cleanup();
      }
    };

    const onCallRejected = () => {
      playDisconnectBeep();
      cleanup();
    };

    const onCallEnded = () => {
      playDisconnectBeep();
      cleanup();
    };

    const onIceCandidate = async ({ candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      if (peerRef.current?.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        pendingCandidates.current.push(candidate);
      }
    };

    const onMicGainChange = ({ gain }: { gain: number }) => {
      remoteMicGainRef.current = gain;
      updateSpeakerVolume();
    };

    socket.on("incoming-call", onIncomingCall);
    socket.on("call-answered", onCallAnswered);
    socket.on("call-rejected", onCallRejected);
    socket.on("call-ended",    onCallEnded);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("mic-gain-change", onMicGainChange);

    return () => {
      socket.off("incoming-call", onIncomingCall);
      socket.off("call-answered", onCallAnswered);
      socket.off("call-rejected", onCallRejected);
      socket.off("call-ended",    onCallEnded);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("mic-gain-change", onMicGainChange);
    };
  }, [socket, micGain, updateSpeakerVolume, cleanup]);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  return {
    callStatus,
    incomingCall,
    isMuted,
    callTargetName,
    remoteAudioRef,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    micGain,
    setMicGain,
    speakerVolume,
    setSpeakerVolume,
  };
}
