import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ServerList from "./ServerList";
import ChannelList from "./ChannelList";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import FriendList from "./FriendList";
import VoiceChannel from "./VoiceChannel";

interface User {
  email: string;
  publicKey: string;
  privateKey: any;
}

interface ChatProps {
  user: User;
  onLogout: () => void;
}

export default function Chat({ user, onLogout }: ChatProps) {
  const router = useRouter();
  const [selectedServer, setSelectedServer] = useState("dm");
  const [selectedChannel, setSelectedChannel] = useState("general");
  const [showVoice, setShowVoice] = useState(false);

  return (
    <div className="h-screen flex bg-[var(--bg-primary)]">
      {/* Left Sidebar - Servers/Friends */}
      <ServerList
        onServerSelect={(serverId) => {
          setSelectedServer(serverId);
          setSelectedChannel("general");
        }}
        selectedServer={selectedServer}
      />

      {/* Middle - Channels */}
      <ChannelList
        serverId={selectedServer}
        onChannelSelect={setSelectedChannel}
        selectedChannel={selectedChannel}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-12 bg-[var(--bg-secondary)] border-b border-[var(--bg-tertiary)] flex items-center justify-between px-4">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">
              {selectedServer === "dm" ? "Direct Messages" : `#${selectedChannel}`}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowVoice(!showVoice)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                showVoice
                  ? "bg-[var(--success)] text-white"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              🎙️ Voice
            </button>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 rounded text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {showVoice ? (
            <VoiceChannel user={user} />
          ) : (
            <MessageList
              user={user}
              serverId={selectedServer}
              channelId={selectedChannel}
            />
          )}
        </div>

        {/* Message Input */}
        {!showVoice && (
          <MessageInput
            user={user}
            serverId={selectedServer}
            channelId={selectedChannel}
          />
        )}
      </div>

      {/* Right Sidebar - Friends/Online */}
      <FriendList user={user} />
    </div>
  );
}