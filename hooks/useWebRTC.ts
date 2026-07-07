/**
 * useWebRTC.ts
 * Manages a 1-to-1 voice call using WebRTC, with Socket.IO as the signaling channel.
 *
 * This version is a pure, clean signaling and media connection engine.
 * It is fully vocal-focused (using a 3-stage equalizer) and supports high-fidelity Opus.
 * Page lifecycle and manual re-dial prompts are delegated to the page components.
 */
"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { ChatSocket } from "@/lib/chatSocket";
import type { CallStatus, IncomingCallData } from "@/types/call";
import type { ChatUser } from "@/types/chat";

const getIceServers = (): RTCIceServer[] => {
  const stunUrl = process.env.NEXT_PUBLIC_STUN_URL || "stun:stun.l.google.com:19302";
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnPassword = process.env.NEXT_PUBLIC_TURN_PASSWORD;

  const servers: RTCIceServer[] = [{ urls: stunUrl }];

  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnPassword,
    });
  }

  servers.push({ urls: "stun:stun1.l.google.com:19302" });
  return servers;
};

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

const playConnectBeep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
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

  const audioContextRef = useRef<AudioContext | null>(null);
  const speakerGainNodeRef = useRef<GainNode | null>(null);

  const ringbackIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const ringbackAudioContextRef = useRef<AudioContext | null>(null);
  const ringsCountRef = useRef(0);
  const endCallRef = useRef<(() => void) | null>(null);
  const isCallerRef = useRef(false);
  const callStartTimestampRef = useRef<number | null>(null);
  const callIdRef = useRef<string>("");

  const stopRingbackTone = useCallback(() => {
    if (ringbackIntervalRef.current) {
      clearInterval(ringbackIntervalRef.current);
      ringbackIntervalRef.current = null;
    }
    if (ringbackAudioContextRef.current) {
      ringbackAudioContextRef.current.close().catch(() => {});
      ringbackAudioContextRef.current = null;
    }
  }, []);

  const startRingbackTone = useCallback(() => {
    stopRingbackTone();
    ringsCountRef.current = 0;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ringbackAudioContextRef.current = ctx;

      const playBeep = () => {
        ringsCountRef.current += 1;
        if (ringsCountRef.current > 7) {
          console.log("[WebRTC] Ringing timeout reached (7 rings). Hanging up.");
          sessionStorage.setItem("last_call_username", callTargetNameRef.current);
          sessionStorage.setItem("last_call_timestamp", Date.now().toString());
          sessionStorage.setItem("last_call_reason", "no_answer");
          endCallRef.current?.();
          return;
        }

        if (ctx.state === "suspended") ctx.resume();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(440, ctx.currentTime);
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(480, ctx.currentTime);

        gainNode.gain.setValueAtTime(0.0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.05, ctx.currentTime + 1.2);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start();
        osc2.start();

        osc1.stop(ctx.currentTime + 1.5);
        osc2.stop(ctx.currentTime + 1.5);
      };

      playBeep();
      ringbackIntervalRef.current = setInterval(playBeep, 3000);
    } catch (err) {
      console.error("Failed to start ringback tone:", err);
    }
  }, [stopRingbackTone]);

  const speakerVolumeRef = useRef(speakerVolume);
  const remoteMicGainRef = useRef(1.0);
  const callTargetNameRef = useRef(callTargetName);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    callTargetNameRef.current = callTargetName;
  }, [callTargetName]);

  // Unlock suspended Web Audio Context on interaction
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
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });

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
        playDisconnectBeep();
        cleanup();
      }
    };

    return pc;
  }, [socket, getAudioContext]);

  const closeActiveConnection = useCallback(() => {
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
    // Log call details on caller's side before clearing targets
    if (isCallerRef.current && socket && callTargetNameRef.current) {
      const elapsed = callStartTimestampRef.current ? Date.now() - callStartTimestampRef.current : 0;
      const isAnswered = elapsed > 0;
      let status: "answered" | "missed" | "declined" = "missed";
      let durationStr: string | undefined;

      if (isAnswered) {
        status = "answered";
        const totalSecs = Math.floor(elapsed / 1000);
        const mm = String(Math.floor(totalSecs / 60)).padStart(2, "0");
        const ss = String(totalSecs % 60).padStart(2, "0");
        durationStr = `${mm}:${ss}`;
      } else {
        const savedReason = sessionStorage.getItem("last_call_reason");
        status = savedReason === "declined" ? "declined" : "missed";
      }

      socket.emit("update-call-status", {
        callId: callIdRef.current,
        status,
        duration: durationStr
      });
    }

    closeActiveConnection();
    stopRingbackTone();

    // Reset caller status
    isCallerRef.current = false;
    callStartTimestampRef.current = null;

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
  }, [closeActiveConnection, stopRingbackTone, socket, username]);

  // ── WebRTC Actions ───────────────────────────────────────────────────────

  const startCall = useCallback(async (targetSocketId: string, targetUsername: string) => {
    if (!socket || callStatus !== "idle") return;

    try {
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
      startRingbackTone();

      const callId = `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      callIdRef.current = callId;
      isCallerRef.current = true;
      callStartTimestampRef.current = null;

      socket.emit("update-call-status", {
        callId,
        status: "calling",
        caller: username,
        receiver: targetUsername
      });

      socket.emit("call-user", { to: targetSocketId, offer: boostedOffer });
    } catch (err) {
      console.error("Failed to start call:", err);
      cleanup();
    }
  }, [socket, callStatus, createPeerConnection, closeActiveConnection, cleanup, startRingbackTone]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !socket) return;

    ringtoneRef.current?.pause();

    try {
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
      playConnectBeep();

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

  endCallRef.current = endCall;

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
      stopRingbackTone();
      try {
        const boostedAnswerSdp = boostAudioBitrate(answer.sdp || "");
        await peerRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: boostedAnswerSdp }));
        for (const c of pendingCandidates.current) {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        pendingCandidates.current = [];
        setCallStatus("active");
        playConnectBeep();
        callStartTimestampRef.current = Date.now();

        socket.emit("update-call-status", {
          callId: callIdRef.current,
          status: "active"
        });

        socket.emit("mic-gain-change", { to: callTargetIdRef.current, gain: micGain });
      } catch (err) {
        console.error("Failed to process call answer:", err);
        cleanup();
      }
    };

    const onCallRejected = () => {
      playDisconnectBeep();
      sessionStorage.setItem("last_call_username", callTargetNameRef.current);
      sessionStorage.setItem("last_call_timestamp", Date.now().toString());
      sessionStorage.setItem("last_call_reason", "declined");
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

  // Automatically clean up call if our call target goes offline (e.g. they refreshed or closed the tab)
  useEffect(() => {
    if (callStatus !== "idle" && callTargetName) {
      const isTargetOnline = connectedUsers.some((u) => u.username === callTargetName);
      if (!isTargetOnline) {
        console.log("[WebRTC] Call partner went offline. Ending call.");
        playDisconnectBeep();
        cleanup();
      }
    }
  }, [connectedUsers, callStatus, callTargetName, cleanup]);

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
