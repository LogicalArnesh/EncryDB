import { useState } from "react";

interface FriendListProps {
  user: any;
}

export default function FriendList({ user }: FriendListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [friends, setFriends] = useState([
    { id: "1", name: "Alice", status: "online", publicKey: "alice_pubkey_example" },
    { id: "2", name: "Bob", status: "offline", publicKey: "bob_pubkey_example" },
    { id: "3", name: "Charlie", status: "online", publicKey: "charlie_pubkey_example" },
  ]);

  const handleAddFriend = () => {
    if (!searchQuery.trim()) return;
    const newFriend = {
      id: Date.now().toString(),
      name: searchQuery,
      status: "offline",
      publicKey: "new_friend_pubkey",
    };
    setFriends([...friends, newFriend]);
    setSearchQuery("");
  };

  return (
    <div className="w-64 bg-[var(--bg-secondary)] border-l border-[var(--bg-tertiary)] flex flex-col">
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--bg-tertiary)]">
        <h3 className="font-semibold text-[var(--text-primary)] text-xs">FRIENDS</h3>
        <span className="text-xs text-[var(--text-secondary)]">{friends.filter(f => f.status === "online").length} online</span>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-[var(--bg-tertiary)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends..."
            className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--bg-tertiary)] rounded text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <button
            onClick={handleAddFriend}
            className="px-3 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded text-sm transition"
          >
            +
          </button>
        </div>
      </div>

      {/* Friends List */}
      <div className="flex-1 overflow-y-auto">
        {friends.map((friend) => (
          <div
            key={friend.id}
            className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-tertiary)] cursor-pointer transition"
          >
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-primary)] font-semibold">
                {friend.name[0]?.toUpperCase()}
              </div>
              <div
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-secondary)] ${
                  friend.status === "online" ? "bg-[var(--success)]" : "bg-[var(--text-secondary)]"
                }`}
              />
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-[var(--text-primary)]">{friend.name}</span>
              <span className="text-xs text-[var(--text-secondary)]">{friend.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}