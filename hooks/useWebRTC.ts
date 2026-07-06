/**
 * useWebRTC.ts
 * Manages a 1-to-1 voice call using WebRTC, with Socket.IO as the signaling channel.
 *
 * State machine:
 *   idle ──startCall──► calling ──call-answered──► active ──endCall──► idle
 *   idle ──incoming-call──► ringing ──acceptCall──► active ──endCall──► idle
 *                                    └──rejectCall──► idle
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
  /** Live socket from useChat — null until connected. */
  socket: ChatSocket | null;
  socketId: string;
  username: string;
}

export interface UseWebRTCReturn {
  callStatus: CallStatus;
  incomingCall: IncomingCallData | null;
  isMuted: boolean;
  /** Name of the remote party (caller or callee). */
  callTargetName: string;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  startCall: (targetSocketId: string, targetUsername: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
}

export function useWebRTC({ socket, socketId, username }: UseWebRTCOptions): UseWebRTCReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callTargetName, setCallTargetName] = useState("");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const callTargetIdRef = useRef<string>("");
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const callStatusRef = useRef<CallStatus>("idle");

  // Sync callStatusRef with callStatus state to avoid stale closure issues in socket listeners
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Preload ringtone
  useEffect(() => {
    if (typeof window === "undefined") return;
    ringtoneRef.current = new Audio("/sounds/calm.mp3");
    ringtoneRef.current.loop = true;
    return () => {
      ringtoneRef.current?.pause();
      ringtoneRef.current = null;
    };
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate && socket && callTargetIdRef.current) {
        socket.emit("ice-candidate", { to: callTargetIdRef.current, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        cleanup();
      }
    };

    return pc;
  }, [socket]);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    pendingCandidates.current = [];
    callTargetIdRef.current = "";
    setCallStatus("idle");
    setIncomingCall(null);
    setCallTargetName("");
    setIsMuted(false);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const startCall = useCallback(async (targetSocketId: string, targetUsername: string) => {
    if (!socket || callStatus !== "idle") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = createPeerConnection();
      peerRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

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
  }, [socket, callStatus, createPeerConnection, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!incomingCall || !socket) return;

    ringtoneRef.current?.pause();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = createPeerConnection();
      peerRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));

      // Flush buffered ICE candidates received before we set the remote description
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
  }, [incomingCall, socket, createPeerConnection, cleanup]);

  const rejectCall = useCallback(() => {
    if (!incomingCall || !socket) return;
    socket.emit("call-rejected", { to: incomingCall.fromSocketId });
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    setIncomingCall(null);
    setCallStatus("idle");
  }, [incomingCall, socket]);

  const endCall = useCallback(() => {
    if (socket && callTargetIdRef.current) {
      socket.emit("call-ended", { to: callTargetIdRef.current });
    }
    cleanup();
  }, [socket, cleanup]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((v) => !v);
  }, []);

  // ── Socket signaling listeners ───────────────────────────────────────────
  // Re-registers whenever the socket instance changes (e.g., reconnect)

  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = ({ from, fromUsername, offer }: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit }) => {
      // Ignore if already in a call (read from Ref to avoid stale closure)
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
        console.error("Failed to process answer:", err);
        cleanup();
      }
    };

    const onCallRejected = () => cleanup();
    const onCallEnded    = () => cleanup();

    const onIceCandidate = async ({ candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      if (peerRef.current?.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        // Buffer until remote description is set
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
  }, [socket, cleanup]); // re-registers when socket instance changes

  // Cleanup on unmount
  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { callStatus, incomingCall, isMuted, callTargetName, remoteAudioRef, startCall, acceptCall, rejectCall, endCall, toggleMute };
}
