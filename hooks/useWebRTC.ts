/**
 * useWebRTC.ts
 * Manages a 1-to-1 voice call using WebRTC, with Socket.IO as the signaling channel.
 *
 * Updates:
 *  - Properly disposes and closes any residual PeerConnection or AudioContext
 *    before initiating or accepting a reconnect call, avoiding connection conflicts.
 *  - Implements document-wide gesture listeners (click/keydown) to automatically unlock
 *    and resume suspended Web Audio AudioContexts due to browser autoplay blocks on reload.
 *  - Plays a high-fidelity synthetic ascending double-beep notification sound upon successful
 *    call reconnection/establishment so users know they are connected.
 */
"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { ChatSocket } from "@/lib/chatSocket";
import type { CallStatus, IncomingCallData } from "@/types/call";
import type { ChatUser } from "@/types/chat";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export interface UseWebRTCOptions {
  socket: ChatSocket | null;
  socketId: string;
  username: string;
  connectedUsers: ChatUser[];
}

export interface UseWebRTCReturn {
  callStatus: CallStatus;
  incomingCall: IncomingCallData | null;
  isMuted: boolean;
  callTargetName: string;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  startCall: (targetSocketId: string, targetUsername: string, isReconnect?: boolean) => Promise<void>;
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
  channelCount: { ideal: 1 },
};

// ── SDP Opus High-Fidelity Booster ───────────────────────────────────────────
function boostAudioBitrate(sdp: string): string {
  let lines = sdp.split("\r\n");
  let opusPayloadType: string | null = null;

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

// Play synthetic ascending double-beep on successful connection
const playConnectBeep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Short ascending beeps (A4 -> C#5)
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(554, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch (e) {
    console.error("Failed to play connect beep:", e);
  }
};

export function useWebRTC({ socket, socketId, username, connectedUsers }: UseWebRTCOptions): UseWebRTCReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callTargetName, setCallTargetName] = useState("");

  const [micGain, setMicGain] = useState(1.0);
  const [speakerVolume, setSpeakerVolume] = useState(1.0);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const callTargetIdRef = useRef<string>("");
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const callStatusRef = useRef<CallStatus>("idle");

  // Track page unload to prevent clearing call session state on refresh
  const isUnloadingRef = useRef(false);
  // Reconnection grace period timeout ref
  const reconnectTimeoutRef = useRef<any>(null);

  // Auto accept trigger state for seamless reconnection
  const [autoAcceptTrigger, setAutoAcceptTrigger] = useState<{ from: string; fromUsername: string; offer: RTCSessionDescriptionInit } | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const speakerGainNodeRef = useRef<GainNode | null>(null);

  const speakerVolumeRef = useRef(speakerVolume);
  const remoteMicGainRef = useRef(1.0);
  const callTargetNameRef = useRef(callTargetName);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    callTargetNameRef.current = callTargetName;
  }, [callTargetName]);

  // Handle page beforeunload to skip clearing call session target
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUnload = () => {
      isUnloadingRef.current = true;
      if (callStatusRef.current === "active" || callStatusRef.current === "calling") {
        sessionStorage.setItem("active_call_timestamp", Date.now().toString());
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // Unlock and resume AudioContext on user interaction to bypass autoplay restrictions on refresh
  useEffect(() => {
    if (typeof window === "undefined") return;
    const resumeContext = () => {
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener("click", resumeContext);
    window.addEventListener("keydown", resumeContext);
    return () => {
      window.removeEventListener("click", resumeContext);
      window.removeEventListener("keydown", resumeContext);
    };
  }, []);

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

  useEffect(() => {
    if (socket && callTargetIdRef.current) {
      socket.emit("mic-gain-change", { to: callTargetIdRef.current, gain: micGain });
    }
  }, [micGain, socket]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    ringtoneRef.current = new Audio("/sounds/calm.mp3");
    ringtoneRef.current.loop = true;
    return () => {
      ringtoneRef.current?.pause();
      ringtoneRef.current = null;
    };
  }, []);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate && socket && callTargetIdRef.current) {
        socket.emit("ice-candidate", { to: callTargetIdRef.current, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];

      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.volume = 0;
        remoteAudioRef.current.play().catch(() => {});
      }

      try {
        const ctx = getAudioContext();
        const source = ctx.createMediaStreamSource(remoteStream);

        const lowCut = ctx.createBiquadFilter();
        lowCut.type = "highpass";
        lowCut.frequency.setValueAtTime(80, ctx.currentTime);

        const warmth = ctx.createBiquadFilter();
        warmth.type = "peaking";
        warmth.frequency.setValueAtTime(200, ctx.currentTime);
        warmth.Q.setValueAtTime(1.0, ctx.currentTime);
        warmth.gain.setValueAtTime(3.5, ctx.currentTime);

        const clarity = ctx.createBiquadFilter();
        clarity.type = "peaking";
        clarity.frequency.setValueAtTime(3000, ctx.currentTime);
        clarity.Q.setValueAtTime(1.2, ctx.currentTime);
        clarity.gain.setValueAtTime(4.0, ctx.currentTime);

        const gainNode = ctx.createGain();
        const initialGain = speakerVolumeRef.current * remoteMicGainRef.current;
        gainNode.gain.setValueAtTime(initialGain, ctx.currentTime);
        speakerGainNodeRef.current = gainNode;

        source.connect(lowCut);
        lowCut.connect(warmth);
        warmth.connect(clarity);
        clarity.connect(gainNode);
        gainNode.connect(ctx.destination);
      } catch (err) {
        console.error("Failed to build Web Audio graph:", err);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        if (isUnloadingRef.current) return;

        console.log("[WebRTC] Call disconnected. Waiting 10s grace period for auto-reconnect...");

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log("[WebRTC] Grace period expired. Cleaning up.");
          sessionStorage.removeItem("active_call_username");
          sessionStorage.removeItem("active_call_timestamp");
          playDisconnectBeep();
          cleanup();
        }, 10000);
      }
    };

    return pc;
  }, [socket, getAudioContext]);

  // Closes active connections and streams cleanly without modifying React state parameters
  const closeActiveConnection = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;

    speakerGainNodeRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    closeActiveConnection();

    ringtoneRef.current?.pause();
    if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    pendingCandidates.current = [];
    callTargetIdRef.current = "";
    remoteMicGainRef.current = 1.0;
    setCallStatus("idle");
    setIncomingCall(null);
    setCallTargetName("");
    setIsMuted(false);
    setAutoAcceptTrigger(null);
  }, [closeActiveConnection]);

  // ── WebRTC Actions ───────────────────────────────────────────────────────

  const startCall = useCallback(async (targetSocketId: string, targetUsername: string, isReconnect?: boolean) => {
    if (!socket || callStatus !== "idle") return;

    try {
      // Clean up any residual connection slots
      closeActiveConnection();

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: HD_AUDIO_CONSTRAINTS,
        video: false,
      });
      localStreamRef.current = rawStream;

      const pc = createPeerConnection();
      peerRef.current = pc;

      rawStream.getTracks().forEach((t) => pc.addTrack(t, rawStream));

      const offer = await pc.createOffer();
      const boostedOfferSdp = boostAudioBitrate(offer.sdp || "");
      const boostedOffer = { type: offer.type, sdp: boostedOfferSdp };

      await pc.setLocalDescription(boostedOffer);

      callTargetIdRef.current = targetSocketId;
      setCallTargetName(targetUsername);
      setCallStatus("calling");

      socket.emit("call-user", { to: targetSocketId, offer: boostedOffer, isReconnect });
    } catch (err) {
      console.error("Failed to start call:", err);
      cleanup();
    }
  }, [socket, callStatus, createPeerConnection, closeActiveConnection, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !socket) return;

    // Clear any pending disconnect timeouts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    ringtoneRef.current?.pause();

    try {
      // Clean up any residual connection slots before starting new session
      closeActiveConnection();

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: HD_AUDIO_CONSTRAINTS,
        video: false,
      });
      localStreamRef.current = rawStream;

      const pc = createPeerConnection();
      peerRef.current = pc;

      rawStream.getTracks().forEach((t) => pc.addTrack(t, rawStream));

      const boostedOfferSdp = boostAudioBitrate(incomingCall.offer.sdp || "");
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: boostedOfferSdp }));

      for (const c of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      pendingCandidates.current = [];

      const answer = await pc.createAnswer();
      const boostedAnswerSdp = boostAudioBitrate(answer.sdp || "");
      const boostedAnswer = { type: answer.type, sdp: boostedAnswerSdp };

      await pc.setLocalDescription(boostedAnswer);

      callTargetIdRef.current = incomingCall.fromSocketId;
      setCallTargetName(incomingCall.fromUsername);
      setCallStatus("active");
      playConnectBeep(); // Play visual/audio connection confirmation chime

      sessionStorage.setItem("active_call_username", incomingCall.fromUsername);
      sessionStorage.removeItem("active_call_timestamp");
      setIncomingCall(null);

      socket.emit("call-answer", { to: incomingCall.fromSocketId, answer: boostedAnswer });
      socket.emit("mic-gain-change", { to: incomingCall.fromSocketId, gain: micGain });
    } catch (err) {
      console.error("Failed to accept call:", err);
      cleanup();
    }
  }, [incomingCall, socket, createPeerConnection, closeActiveConnection, micGain, cleanup]);

  const rejectCall = useCallback(() => {
    if (!incomingCall || !socket) return;
    socket.emit("call-rejected", { to: incomingCall.fromSocketId });
    sessionStorage.removeItem("active_call_username");
    sessionStorage.removeItem("active_call_timestamp");
    playDisconnectBeep();
    cleanup();
  }, [incomingCall, socket, cleanup]);

  const endCall = useCallback(() => {
    if (socket && callTargetIdRef.current) {
      socket.emit("call-ended", { to: callTargetIdRef.current });
    }
    sessionStorage.removeItem("active_call_username");
    sessionStorage.removeItem("active_call_timestamp");
    playDisconnectBeep();
    cleanup();
  }, [socket, cleanup]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((v) => !v);
  }, []);

  // ── Auto-Reconnect Handler ───────────────────────────────────────────────
  useEffect(() => {
    if (!socket || callStatus !== "idle") return;
    const savedActiveUser = sessionStorage.getItem("active_call_username");
    const savedTimestamp = sessionStorage.getItem("active_call_timestamp");

    if (savedActiveUser) {
      if (savedTimestamp) {
        const elapsed = Date.now() - parseInt(savedTimestamp, 10);
        if (elapsed > 10000) {
          console.log("[call-reconnect] Refresh window expired (> 10s). Clearing call state.");
          sessionStorage.removeItem("active_call_username");
          sessionStorage.removeItem("active_call_timestamp");
          return;
        }
      }

      const activeUserObj = connectedUsers.find((u) => u.username === savedActiveUser);
      if (activeUserObj) {
        console.log("[call-reconnect] Auto dialing target peer within 10s window:", savedActiveUser);
        sessionStorage.removeItem("active_call_timestamp");
        startCall(activeUserObj.id, activeUserObj.username, true);
      }
    }
  }, [connectedUsers, socket, callStatus, startCall]);

  useEffect(() => {
    if (autoAcceptTrigger && callStatus === "ringing" && incomingCall) {
      console.log("[call-reconnect] Auto-accepting reconnecting call from:", autoAcceptTrigger.fromUsername);
      acceptCall().then(() => {
        setAutoAcceptTrigger(null);
      });
    }
  }, [autoAcceptTrigger, callStatus, incomingCall, acceptCall]);

  // ── Socket event listeners ───────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = ({ from, fromUsername, offer, isReconnect }: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit; isReconnect?: boolean }) => {
      const wasInCallWithThem = sessionStorage.getItem("active_call_username") === fromUsername;

      if (isReconnect && wasInCallWithThem) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        setIncomingCall({ fromSocketId: from, fromUsername, offer });
        setCallStatus("ringing");
        setAutoAcceptTrigger({ from, fromUsername, offer });
        return;
      }

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
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        const boostedAnswerSdp = boostAudioBitrate(answer.sdp || "");
        await peerRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: boostedAnswerSdp }));
        for (const c of pendingCandidates.current) {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        pendingCandidates.current = [];
        setCallStatus("active");
        playConnectBeep(); // Play visual/audio connection confirmation chime

        sessionStorage.setItem("active_call_username", callTargetNameRef.current);
        sessionStorage.removeItem("active_call_timestamp");
        socket.emit("mic-gain-change", { to: callTargetIdRef.current, gain: micGain });
      } catch (err) {
        console.error("Failed to process call answer:", err);
        cleanup();
      }
    };

    const onCallRejected = () => {
      sessionStorage.removeItem("active_call_username");
      sessionStorage.removeItem("active_call_timestamp");
      playDisconnectBeep();
      cleanup();
    };

    const onCallEnded = () => {
      sessionStorage.removeItem("active_call_username");
      sessionStorage.removeItem("active_call_timestamp");
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
