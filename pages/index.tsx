import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Login from "../components/Login";
import Register from "../components/Register";
import Chat from "../components/Chat";

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem("encrydb_user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-[var(--text-secondary)]">Loading EncryDB...</div>
      </div>
    );
  }

  if (user) {
    return <Chat user={user} onLogout={() => { localStorage.removeItem("encrydb_user"); setUser(null); }} />;
  }

  return <Login onSwitchToRegister={() => router.push("/register")} />;
}