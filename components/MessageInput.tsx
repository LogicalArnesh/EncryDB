import { useState } from "react";
import { EncryDBCrypto } from "../lib/crypto";

interface MessageInputProps {
  user: any;
  serverId: string;
  channelId: string;
}

export default function MessageInput({ user, serverId, channelId }: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const sendMessage = async () => {
    if (!message.trim()) return;

    setSending(true);
    try {
      // In a real app, encrypt with recipient's public key
      // For demo, store locally
      const newMessage = {
        id: Date.now().toString(),
        sender: user.email.split("@")[0],
        content: message,
        timestamp: new Date().toISOString(),
        encrypted: true,
      };

      const saved = localStorage.getItem(`encrydb_msgs_${serverId}_${channelId}`);
      const msgs = saved ? JSON.parse(saved) : [];
      msgs.push(newMessage);
      localStorage.setItem(`encrydb_msgs_${serverId}_${channelId}`, JSON.stringify(msgs));

      setMessage("");
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4 border-t border-[var(--bg-tertiary)]">
      <div className="flex items-end gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Type a message..."
          className="flex-1 px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          onClick={sendMessage}
          disabled={sending || !message.trim()}
          className="px-4 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}