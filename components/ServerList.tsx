import { useState } from "react";

interface ServerListProps {
  onServerSelect: (serverId: string) => void;
  selectedServer: string;
}

export default function ServerList({ onServerSelect, selectedServer }: ServerListProps) {
  const servers = [
    { id: "dm", name: "Direct Messages", icon: "💬" },
    { id: "server1", name: "General", icon: "🏠" },
    { id: "server2", name: "Development", icon: "💻" },
  ];

  return (
    <div className="w-16 bg-[var(--bg-secondary)] border-r border-[var(--bg-tertiary)] flex flex-col items-center py-3 gap-2">
      {servers.map((server) => (
        <button
          key={server.id}
          onClick={() => onServerSelect(server.id)}
          className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl transition ${
            selectedServer === server.id
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          }`}
          title={server.name}
        >
          {server.icon}
        </button>
      ))}

      <div className="mt-4">
        <button
          className="w-12 h-12 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--accent)] hover:text-white transition flex items-center justify-center text-2xl"
          title="Create Server"
        >
          +
        </button>
      </div>
    </div>
  );
}