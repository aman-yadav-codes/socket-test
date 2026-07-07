/**
 * useWebRTC.ts
 * Manages 1-to-1 Audio and Video calls using WebRTC and Socket.IO generic signaling.
 *
 * Implements high-fidelity audio equalization, dynamic video stream management,
 * call quality statistics monitoring, and automatic codec/bitrate adaptation.
 */
"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { ChatSocket } from "@/lib/chatSocket";
import type { CallStatus, CallType, IncomingCallData, CallStats } from "@/types/call";
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
  callType: CallType;
  incomingCall: IncomingCallData | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isRemoteVideoEnabled: boolean;
  callTargetName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (targetSocketId: string, targetUsername: string, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;

  // Upgrades
  incomingUpgradeRequest: boolean;
  requestVideoUpgrade: () => Promise<void>;
  respondVideoUpgrade: (accepted: boolean) => Promise<void>;

  // Stats
  stats: CallStats | null;

  // Sliders
  micGain: number;
  setMicGain: (v: number) => void;
  speakerVolume: number;
  setSpeakerVolume: (v: number) => void;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
}

// ── Media Constraints ─────────────────────────────────────────
const HD_AUDIO_CONSTRAINTS = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  sampleRate: { ideal: 48000 },
  sampleSize: { ideal: 16 },
  channelCount: { ideal: 1 },
};

const HD_VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 60 },
  facingMode: "user",
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
    }, 350);
  } catch (e) {
    console.error("Failed to play connect beep:", e);
  }
};

export function useWebRTC({
  socket,
  socketId,
  username,
  connectedUsers,
}: UseWebRTCOptions): UseWebRTCReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isRemoteVideoEnabled, setIsRemoteVideoEnabled] = useState(false);
  const [callTargetName, setCallTargetName] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  // Upgrades
  const [incomingUpgradeRequest, setIncomingUpgradeRequest] = useState(false);
  const upgradeOfferRef = useRef<RTCSessionDescriptionInit | null>(null);

  // Stats
  const [stats, setStats] = useState<CallStats | null>(null);

  // Sliders
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

  // Sync refs
  useEffect(() => {
    speakerVolumeRef.current = speakerVolume;
  }, [speakerVolume]);

  useEffect(() => {
    callTargetNameRef.current = callTargetName;
  }, [callTargetName]);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Load call ringtone
  useEffect(() => {
    ringtoneRef.current = new Audio("/sounds/calm.mp3");
    ringtoneRef.current.loop = true;
  }, []);

  const updateSpeakerVolume = useCallback(() => {
    if (speakerGainNodeRef.current) {
      const computedVol = speakerVolumeRef.current * remoteMicGainRef.current;
      speakerGainNodeRef.current.gain.setValueAtTime(computedVol, 0);
    }
  }, []);

  // Sync remote volume changes locally
  useEffect(() => {
    updateSpeakerVolume();
  }, [speakerVolume, updateSpeakerVolume]);

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
        socket.emit("call:ice-candidate", { to: callTargetIdRef.current, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      const rStream = e.streams[0];
      setRemoteStream(rStream);

      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = rStream;
        remoteAudioRef.current.volume = 0;
        remoteAudioRef.current.play().catch(() => {});
      }

      // Route Audio through Vocal Equalizer Context
      if (e.track.kind === "audio") {
        try {
          const ctx = getAudioContext();
          const src = ctx.createMediaStreamSource(rStream);
          const gainNode = ctx.createGain();

          const lowFilter = ctx.createBiquadFilter();
          lowFilter.type = "lowshelf";
          lowFilter.frequency.value = 250;
          lowFilter.gain.value = -8;

          const midFilter = ctx.createBiquadFilter();
          midFilter.type = "peaking";
          midFilter.frequency.value = 1500;
          midFilter.Q.value = 1.0;
          midFilter.gain.value = 4;

          const highFilter = ctx.createBiquadFilter();
          highFilter.type = "highshelf";
          highFilter.frequency.value = 4000;
          highFilter.gain.value = 3;

          gainNode.gain.value = remoteMicGainRef.current;
          speakerGainNodeRef.current = gainNode;

          src.connect(lowFilter);
          lowFilter.connect(midFilter);
          midFilter.connect(highFilter);
          highFilter.connect(gainNode);
          gainNode.connect(ctx.destination);

          updateSpeakerVolume();
        } catch (err) {
          console.error("Web Audio Equalizer routing failed:", err);
          if (remoteAudioRef.current) {
            remoteAudioRef.current.volume = 1.0;
          }
        }
      }
    };

    return pc;
  }, [socket, getAudioContext, updateSpeakerVolume]);

  const closeActiveConnection = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
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
    stopRingbackTone();

    ringtoneRef.current?.pause();
    if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    pendingCandidates.current = [];
    callTargetIdRef.current = "";
    remoteMicGainRef.current = 1.0;
    setCallStatus("idle");
    setCallType("audio");
    setIncomingCall(null);
    setCallTargetName("");
    setIsMuted(false);
    setIsVideoEnabled(false);
    setIsRemoteVideoEnabled(false);
    setIncomingUpgradeRequest(false);
    upgradeOfferRef.current = null;
    setStats(null);
  }, [closeActiveConnection, stopRingbackTone]);

  // ── WebRTC Actions ───────────────────────────────────────────────────────

  const startCall = useCallback(async (targetSocketId: string, targetUsername: string, type: CallType) => {
    if (!socket || callStatus !== "idle") return;

    try {
      closeActiveConnection();
      setCallType(type);

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: HD_AUDIO_CONSTRAINTS,
        video: type === "video" ? HD_VIDEO_CONSTRAINTS : false,
      });
      localStreamRef.current = rawStream;
      setLocalStream(rawStream);
      setIsVideoEnabled(type === "video");

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

      socket.emit("call:start", { to: targetSocketId, offer: boostedOffer, callType: type });
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
      const type = incomingCall.callType;
      setCallType(type);

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: HD_AUDIO_CONSTRAINTS,
        video: type === "video" ? HD_VIDEO_CONSTRAINTS : false,
      });
      localStreamRef.current = rawStream;
      setLocalStream(rawStream);
      setIsVideoEnabled(type === "video");
      setIsRemoteVideoEnabled(type === "video");

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

      socket.emit("call:answer", { to: incomingCall.fromSocketId, answer: boostedAnswer });
      socket.emit("call:mic-gain", { to: incomingCall.fromSocketId, gain: micGain });
    } catch (err) {
      console.error("Failed to accept call:", err);
      cleanup();
    }
  }, [incomingCall, socket, createPeerConnection, closeActiveConnection, micGain, cleanup]);

  const rejectCall = useCallback(() => {
    if (!incomingCall || !socket) return;
    socket.emit("call:reject", { to: incomingCall.fromSocketId });
    playDisconnectBeep();
    cleanup();
  }, [incomingCall, socket, cleanup]);

  const endCall = useCallback(() => {
    if (socket && callTargetIdRef.current) {
      socket.emit("call:end", { to: callTargetIdRef.current });
    }
    playDisconnectBeep();
    cleanup();
  }, [socket, cleanup]);

  endCallRef.current = endCall;

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const nextVal = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !nextVal; });
    setIsMuted(nextVal);
    if (socket && callTargetIdRef.current) {
      socket.emit("call:media-toggle", {
        to: callTargetIdRef.current,
        audioEnabled: !nextVal,
        videoEnabled: isVideoEnabled
      });
    }
  }, [isMuted, isVideoEnabled, socket]);

  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current || !peerRef.current) return;
    
    const nextVal = !isVideoEnabled;
    let videoTrack = localStreamRef.current.getVideoTracks()[0];

    // If enabling camera and we don't have a video track yet, capture it dynamically
    if (nextVal && !videoTrack) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: HD_VIDEO_CONSTRAINTS, audio: false });
        videoTrack = tempStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(videoTrack);
        
        // Add to PeerConnection
        peerRef.current.addTrack(videoTrack, localStreamRef.current);
      } catch (err) {
        console.error("Failed to acquire video track on toggle:", err);
        return;
      }
    }

    if (videoTrack) {
      videoTrack.enabled = nextVal;
    }
    
    setIsVideoEnabled(nextVal);
    
    if (socket && callTargetIdRef.current) {
      socket.emit("call:media-toggle", {
        to: callTargetIdRef.current,
        audioEnabled: !isMuted,
        videoEnabled: nextVal
      });
    }
  }, [isVideoEnabled, isMuted, socket]);

  // ── WebRTC Renegotiation Upgrades ────────────────────────────────────────

  const requestVideoUpgrade = useCallback(async () => {
    if (!peerRef.current || !localStreamRef.current || !socket || callStatus !== "active") return;
    
    try {
      let videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (!videoTrack) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: HD_VIDEO_CONSTRAINTS, audio: false });
        videoTrack = tempStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(videoTrack);
        peerRef.current.addTrack(videoTrack, localStreamRef.current);
      }
      
      videoTrack.enabled = true;
      setIsVideoEnabled(true);
      setCallType("video");

      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);

      socket.emit("call:upgrade-request", { to: callTargetIdRef.current, offer });
    } catch (err) {
      console.error("Video upgrade request failed:", err);
    }
  }, [socket, callStatus]);

  const respondVideoUpgrade = useCallback(async (accepted: boolean) => {
    setIncomingUpgradeRequest(false);
    const offer = upgradeOfferRef.current;
    upgradeOfferRef.current = null;

    if (!socket || !peerRef.current || !localStreamRef.current) return;

    if (!accepted) {
      socket.emit("call:upgrade-response", { to: callTargetIdRef.current, accepted: false });
      return;
    }

    try {
      let videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (!videoTrack) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: HD_VIDEO_CONSTRAINTS, audio: false });
        videoTrack = tempStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(videoTrack);
        peerRef.current.addTrack(videoTrack, localStreamRef.current);
      }
      
      videoTrack.enabled = true;
      setIsVideoEnabled(true);
      setIsRemoteVideoEnabled(true);
      setCallType("video");

      if (offer) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerRef.current.createAnswer();
        await peerRef.current.setLocalDescription(answer);

        socket.emit("call:upgrade-response", { to: callTargetIdRef.current, answer, accepted: true });
      }
    } catch (err) {
      console.error("Failed to accept video upgrade:", err);
    }
  }, [socket]);

  // ── Network Quality Monitor & Quality Scaling ────────────────────────────

  useEffect(() => {
    if (callStatus !== "active" || !peerRef.current) {
      setStats(null);
      return;
    }

    let lastPacketsLost = 0;
    let lastPacketsReceived = 0;

    const interval = setInterval(async () => {
      if (!peerRef.current) return;
      try {
        const report = await peerRef.current.getStats();
        let rtt = 0;
        let jitter = 0;
        let packetLoss = 0;
        let resolution = "Audio Only";
        let fps = 0;

        report.forEach((stat) => {
          if (stat.type === "candidate-pair" && stat.state === "succeeded") {
            rtt = Math.round((stat.currentRoundTripTime || 0) * 1000);
          }

          if (stat.type === "inbound-rtp") {
            if (stat.mediaType === "audio" || stat.kind === "audio") {
              jitter = Math.round((stat.jitter || 0) * 1000);
            }
            if (stat.mediaType === "video" || stat.kind === "video") {
              const w = stat.frameWidth || 0;
              const h = stat.frameHeight || 0;
              if (w && h) {
                resolution = `${w}x${h}`;
              }
              fps = stat.framesPerSecond || 0;
            }

            const currentLost = stat.packetsLost || 0;
            const currentReceived = stat.packetsReceived || 0;
            const deltaLost = currentLost - lastPacketsLost;
            const deltaReceived = currentReceived - lastPacketsReceived;
            
            if (deltaLost + deltaReceived > 0) {
              packetLoss = parseFloat(((deltaLost / (deltaLost + deltaReceived)) * 100).toFixed(1));
            }
            
            lastPacketsLost = currentLost;
            lastPacketsReceived = currentReceived;
          }
        });

        // Compute Network Quality State
        let quality: CallStats["quality"] = "Excellent";
        if (rtt > 400 || packetLoss > 15) {
          quality = "Poor";
        } else if (rtt > 250 || packetLoss > 8) {
          quality = "Weak";
        } else if (rtt > 140 || packetLoss > 4) {
          quality = "Fair";
        } else if (rtt > 70 || packetLoss > 1.5) {
          quality = "Good";
        }

        setStats({
          rtt,
          jitter,
          packetLoss,
          resolution,
          fps,
          quality,
        });

        // Auto Quality Adaptation
        const videoSender = peerRef.current.getSenders().find((s) => s.track && s.track.kind === "video");
        if (videoSender && videoSender.track) {
          const params = videoSender.getParameters();
          if (!params.encodings) params.encodings = [{}];

          if (quality === "Excellent" || quality === "Good") {
            params.encodings[0].maxBitrate = 1500000;
            params.encodings[0].scaleResolutionDownBy = 1.0;
            videoSender.track.enabled = true;
          } else if (quality === "Fair") {
            params.encodings[0].maxBitrate = 600000;
            params.encodings[0].scaleResolutionDownBy = 1.5;
            videoSender.track.enabled = true;
          } else if (quality === "Weak") {
            params.encodings[0].maxBitrate = 250000;
            params.encodings[0].scaleResolutionDownBy = 2.0;
            videoSender.track.enabled = true;
          } else {
            params.encodings[0].maxBitrate = 100000;
            params.encodings[0].scaleResolutionDownBy = 3.0;
            if (packetLoss > 20 || rtt > 500) {
              videoSender.track.enabled = false;
            }
          }
          await videoSender.setParameters(params).catch(() => {});
        }
      } catch (err) {
        console.error("Stats loop error:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [callStatus]);

  // Sync mic gain settings remotely
  useEffect(() => {
    if (socket && callTargetIdRef.current && callStatus === "active") {
      socket.emit("call:mic-gain", { to: callTargetIdRef.current, gain: micGain });
    }
  }, [micGain, socket, callStatus]);

  // ── Socket event listeners ───────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const onCallStart = ({ from, fromUsername, offer, callType: incomingType }: { from: string; fromUsername: string; offer: RTCSessionDescriptionInit; callType: CallType }) => {
      if (callStatusRef.current !== "idle") {
        socket.emit("call:reject", { to: from });
        return;
      }
      setIncomingCall({ fromSocketId: from, fromUsername, offer, callType: incomingType });
      setCallStatus("ringing");
      setCallType(incomingType);
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

    const onMediaToggle = ({ audioEnabled, videoEnabled }: { from: string; audioEnabled: boolean; videoEnabled: boolean }) => {
      setIsRemoteVideoEnabled(videoEnabled);
    };

    const onUpgradeRequest = ({ offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      upgradeOfferRef.current = offer;
      setIncomingUpgradeRequest(true);
    };

    const onUpgradeResponse = async ({ answer, accepted }: { from: string; answer?: RTCSessionDescriptionInit; accepted: boolean }) => {
      const pc = peerRef.current;
      if (!accepted || !pc) {
        // Remove local video tracks if rejected
        const videoTrack = localStreamRef.current?.getVideoTracks()[0];
        if (videoTrack) {
          if (pc) {
            const sender = pc.getSenders().find((s) => s.track === videoTrack);
            if (sender) pc.removeTrack(sender);
          }
          videoTrack.stop();
          localStreamRef.current?.removeTrack(videoTrack);
          setLocalStream(localStreamRef.current ? new MediaStream(localStreamRef.current.getTracks()) : null);
        }
        setIsVideoEnabled(false);
        setCallType("audio");
        alert(`${callTargetNameRef.current} rejected the video upgrade.`);
        return;
      }

      if (answer) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          setIsRemoteVideoEnabled(true);
          setCallType("video");
        } catch (err) {
          console.error("Failed to process video upgrade answer:", err);
        }
      }
    };

    socket.on("call:start", onCallStart);
    socket.on("call:answer", onCallAnswered);
    socket.on("call:reject", onCallRejected);
    socket.on("call:end",    onCallEnded);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:mic-gain", onMicGainChange);
    socket.on("call:media-toggle", onMediaToggle);
    socket.on("call:upgrade-request", onUpgradeRequest);
    socket.on("call:upgrade-response", onUpgradeResponse);

    return () => {
      socket.off("call:start", onCallStart);
      socket.off("call:answer", onCallAnswered);
      socket.off("call:reject", onCallRejected);
      socket.off("call:end",    onCallEnded);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:mic-gain", onMicGainChange);
      socket.off("call:media-toggle", onMediaToggle);
      socket.off("call:upgrade-request", onUpgradeRequest);
      socket.off("call:upgrade-response", onUpgradeResponse);
    };
  }, [socket, updateSpeakerVolume, cleanup, stopRingbackTone]);

  // Handle partner going offline
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
    callType,
    incomingCall,
    isMuted,
    isVideoEnabled,
    isRemoteVideoEnabled,
    callTargetName,
    localStream,
    remoteStream,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    incomingUpgradeRequest,
    requestVideoUpgrade,
    respondVideoUpgrade,
    stats,
    micGain,
    setMicGain,
    speakerVolume,
    setSpeakerVolume,
    remoteAudioRef,
  };
}
