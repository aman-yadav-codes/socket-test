/** Types for the voice call state machine. */

export type CallStatus = "idle" | "calling" | "ringing" | "active";

export interface IncomingCallData {
  fromSocketId: string;
  fromUsername: string;
  offer: RTCSessionDescriptionInit;
}
