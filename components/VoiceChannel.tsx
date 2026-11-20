import { useState, useEffect, useRef } from "react";
import { VoiceCallSession } from "../lib/webrtc";

interface VoiceChannelProps {
  user: any;
}

export default function VoiceChannel({ user }: VoiceChannelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [callStatus, setCallStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [participants, setParticipants] = useState([
    { name: "You", muted: false },
    { name: "Alice", muted: false },
    { name: "Bob", muted: false },
  ]);

  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const callSession = useRef<VoiceCallSession | null>(null);

  const startCall = async () => {
    setCallStatus("connecting");
    try {
      callSession.current = new VoiceCallSession(
        localAudioRef.current!,
        remoteAudioRef.current!,
        (msg) => {
          // In production, send via WebSocket signaling
          console.log("Signaling message:", msg);
        }
      );
      await callSession.current.startCall();
      setCallStatus("connected");
    } catch (err) {
      console.error("Call failed:", err);
      setCallStatus("disconnected");
    }
  };

  const endCall = () => {
    if (callSession.current) {
      callSession.current.endCall();
      callSession.current = null;
    }
    setCallStatus("disconnected");
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (callSession.current?.localStream) {
      callSession.current.localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-secondary)] p-8">
      <div className="w-32 h-32 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-5xl mb-6">
        🎙️
      </div>

      <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
        Voice Channel
      </h2>
      <p className="text-[var(--text-secondary)] mb-8">
        {callStatus === "connected" ? "Connected" : "Not connected"}
      </p>

      {/* Participants */}
      <div className="flex gap-4 mb-8">
        {participants.map((p, idx) => (
          <div key={idx} className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xl font-semibold mb-2">
              {p.name[0]?.toUpperCase()}
            </div>
            <span className="text-sm text-[var(--text-primary)]">{p.name}</span>
            {p.muted && <span className="text-xs text-[var(--danger)]">-muted</span>}
          </div>
        ))}
      </div>

      {/* Call Controls */}
      <div className="flex gap-4">
        <button
          onClick={toggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition ${
            isMuted ? "bg-[var(--danger)] text-white" : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          }`}
          title="Mute"
        >
          {isMuted ? "🔇" : "🎤"}
        </button>

        {callStatus === "disconnected" ? (
          <button
            onClick={startCall}
            className="w-14 h-14 rounded-full bg-[var(--success)] text-white flex items-center justify-center text-xl hover:bg-green-600 transition"
            title="Join Call"
          >
            📞
          </button>
        ) : (
          <button
            onClick={endCall}
            className="w-14 h-14 rounded-full bg-[var(--danger)] text-white flex items-center justify-center text-xl hover:bg-red-700 transition"
            title="End Call"
          >
            📴
          </button>
        )}

        <button
          onClick={() => setIsDeafened(!isDeafened)}
          className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition ${
            isDeafened ? "bg-[var(--danger)] text-white" : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          }`}
          title="Deafen"
        >
          {isDeafened ? "🔇" : "🔊"}
        </button>
      </div>

      <audio ref={localAudioRef} muted />
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}