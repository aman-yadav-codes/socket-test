/**
 * useWebRTC.ts
 * Manages a 1-to-1 voice call using WebRTC, with Socket.IO as the signaling channel.
 *
 * It uses the Web Audio API to route and boost both incoming speaker audio
 * and outgoing mic gain, providing the adjustable sliders the user requested.
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

  // Sound adjustments (default 100% gain = 1.0)
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
  const micGainNodeRef = useRef<GainNode | null>(null);
  const speakerGainNodeRef = useRef<GainNode | null>(null);

  // Sync state refs to prevent stale closure bugs in callbacks
  const speakerVolumeRef = useRef(speakerVolume);
  const micGainRef = useRef(micGain);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    speakerVolumeRef.current = speakerVolume;
    if (speakerGainNodeRef.current && audioContextRef.current) {
      speakerGainNodeRef.current.gain.setValueAtTime(speakerVolume, audioContextRef.current.currentTime);
    }
  }, [speakerVolume]);

  useEffect(() => {
    micGainRef.current = micGain;
    if (micGainNodeRef.current && audioContextRef.current) {
      micGainNodeRef.current.gain.setValueAtTime(micGain, audioContextRef.current.currentTime);
    }
  }, [micGain]);

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

      // Mute the raw audio element (set volume to 0) to prevent double audio playback
      // since we route it through AudioContext destination node below
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.volume = 0;
        remoteAudioRef.current.play().catch(() => {});
      }

      try {
        const ctx = getAudioContext();
        const source = ctx.createMediaStreamSource(remoteStream);
        const gainNode = ctx.createGain();

        gainNode.gain.setValueAtTime(speakerVolumeRef.current, ctx.currentTime);
        speakerGainNodeRef.current = gainNode;

        source.connect(gainNode);
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

    // Close and reset Web Audio nodes
    micGainNodeRef.current = null;
    speakerGainNodeRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    pendingCandidates.current = [];
    callTargetIdRef.current = "";
    setCallStatus("idle");
    setIncomingCall(null);
    setCallTargetName("");
    setIsMuted(false);
  }, []);

  // ── WebRTC Actions ───────────────────────────────────────────────────────

  const startCall = useCallback(async (targetSocketId: string, targetUsername: string) => {
    if (!socket || callStatus !== "idle") return;

    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = rawStream;

      const pc = createPeerConnection();
      peerRef.current = pc;

      // Process outgoing microphone audio via Web Audio GainNode to support gain boost
      try {
        const ctx = getAudioContext();
        const source = ctx.createMediaStreamSource(rawStream);
        const gainNode = ctx.createGain();

        gainNode.gain.setValueAtTime(micGainRef.current, ctx.currentTime);
        micGainNodeRef.current = gainNode;

        const dest = ctx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(dest);

        dest.stream.getAudioTracks().forEach((t) => pc.addTrack(t, rawStream));
      } catch (err) {
        console.error("Local audio context routing failed, falling back to raw mic:", err);
        rawStream.getTracks().forEach((t) => pc.addTrack(t, rawStream));
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      callTargetIdRef.current = targetSocketId;
      setCallTargetName(targetUsername);
      setCallStatus("calling");

      socket.emit("call-user", { to: targetSocketId, offer });
    } catch (err) {
      console.error("Failed to start call:", err);
      cleanup();
    }
  }, [socket, callStatus, createPeerConnection, getAudioContext, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !socket) return;

    ringtoneRef.current?.pause();

    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = rawStream;

      const pc = createPeerConnection();
      peerRef.current = pc;

      // Process mic volume level via Web Audio
      try {
        const ctx = getAudioContext();
        const source = ctx.createMediaStreamSource(rawStream);
        const gainNode = ctx.createGain();

        gainNode.gain.setValueAtTime(micGainRef.current, ctx.currentTime);
        micGainNodeRef.current = gainNode;

        const dest = ctx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(dest);

        dest.stream.getAudioTracks().forEach((t) => pc.addTrack(t, rawStream));
      } catch (err) {
        console.error("Local audio context routing failed, falling back to raw mic:", err);
        rawStream.getTracks().forEach((t) => pc.addTrack(t, rawStream));
      }

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));

      for (const c of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      pendingCandidates.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      callTargetIdRef.current = incomingCall.fromSocketId;
      setCallTargetName(incomingCall.fromUsername);
      setCallStatus("active");
      setIncomingCall(null);

      socket.emit("call-answer", { to: incomingCall.fromSocketId, answer });
    } catch (err) {
      console.error("Failed to accept call:", err);
      cleanup();
    }
  }, [incomingCall, socket, createPeerConnection, getAudioContext, cleanup]);

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
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        for (const c of pendingCandidates.current) {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        pendingCandidates.current = [];
        setCallStatus("active");
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

    socket.on("incoming-call", onIncomingCall);
    socket.on("call-answered", onCallAnswered);
    socket.on("call-rejected", onCallRejected);
    socket.on("call-ended",    onCallEnded);
    socket.on("ice-candidate", onIceCandidate);

    return () => {
      socket.off("incoming-call", onIncomingCall);
      socket.off("call-answered", onCallAnswered);
      socket.off("call-rejected", onCallRejected);
      socket.off("call-ended",    onCallEnded);
      socket.off("ice-candidate", onIceCandidate);
    };
  }, [socket, cleanup]);

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
