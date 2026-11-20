interface ChannelListProps {
  serverId: string;
  onChannelSelect: (channelId: string) => void;
  selectedChannel: string;
}

export default function ChannelList({ serverId, onChannelSelect, selectedChannel }: ChannelListProps) {
  const channels = [
    { id: "general", name: "general", type: "text" },
    { id: "announcements", name: "announcements", type: "text" },
    { id: "voice", name: "Voice Channel", type: "voice" },
  ];

  return (
    <div className="w-60 bg-[var(--bg-secondary)] border-r border-[var(--bg-tertiary)] flex flex-col">
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--bg-tertiary)]">
        <h3 className="font-semibold text-[var(--text-primary)] uppercase text-xs">
          {serverId === "dm" ? "Direct Messages" : "Server Channels"}
        </h3>
        <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">+</button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onChannelSelect(channel.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition ${
              selectedChannel === channel.id
                ? "bg-[var(--bg-tertiary)] text-white"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-white"
            }`}
          >
            <span>{channel.type === "voice" ? "🎙️" : "#"}</span>
            <span>{channel.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}