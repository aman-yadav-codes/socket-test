/** Types for the voice call state machine. */

export type CallStatus = "idle" | "calling" | "ringing" | "active";
export type CallType = "audio" | "video";

export interface IncomingCallData {
  fromSocketId: string;
  fromUsername: string;
  offer: RTCSessionDescriptionInit;
  callType: CallType;
}

export interface CallStats {
  rtt: number;
  jitter: number;
  packetLoss: number;
  resolution: string;
  fps: number;
  quality: "Excellent" | "Good" | "Fair" | "Weak" | "Poor";
}
