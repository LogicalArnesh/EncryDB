import { useState, useEffect, useRef } from "react";
import { EncryDBCrypto } from "../lib/crypto";

interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  encrypted: boolean;
}

interface MessageListProps {
  user: any;
  serverId: string;
  channelId: string;
}

export default function MessageList({ user, serverId, channelId }: MessageListProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load messages from localStorage
    const saved = localStorage.getItem(`encrydb_msgs_${serverId}_${channelId}`);
    if (saved) {
      setMessages(JSON.parse(saved));
    } else {
      // Default welcome message
      const welcome: Message = {
        id: "1",
        sender: "EncryDB",
        content: `Welcome to ${channelId}! Messages are end-to-end encrypted.`,
        timestamp: new Date().toISOString(),
        encrypted: false,
      };
      setMessages([welcome]);
      localStorage.setItem(`encrydb_msgs_${serverId}_${channelId}`, JSON.stringify([welcome]));
    }
  }, [serverId, channelId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div key={msg.id} className="flex gap-3 fade-in">
          <div className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white font-semibold flex-shrink-0">
            {msg.sender[0]?.toUpperCase()}
          </div>
          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-[var(--text-primary)]">{msg.sender}</span>
              <span className="text-xs text-[var(--text-secondary)]">{formatTime(msg.timestamp)}</span>
            </div>
            <p className="text-[var(--text-primary)] text-sm mt-0.5">{msg.content}</p>
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}