import { useState } from "react";
import { EncryDBCrypto } from "../lib/crypto";

interface LoginProps {
  onSwitchToRegister: () => void;
}

export default function Login({ onSwitchToRegister }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Check if user exists locally
      const savedUser = localStorage.getItem("encrydb_user");
      if (savedUser) {
        const user = JSON.parse(savedUser);
        if (user.email === email) {
          // Generate key pair if not exists
          if (!user.publicKey) {
            const keyPair = await EncryDBCrypto.generateKeyPair();
            const pubKey = await EncryDBCrypto.exportPublicKey(keyPair.publicKey);
            const updatedUser = {
              ...user,
              publicKey: pubKey,
              privateKey: keyPair.privateKey
            };
            localStorage.setItem("encrydb_user", JSON.stringify(updatedUser));
          }
          window.location.href = "/";
          return;
        }
      }
      setError("Invalid email or password");
    } catch (err) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="bg-[var(--bg-secondary)] rounded-lg shadow-xl w-full max-w-md p-8 fade-in">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--accent)] mb-2">EncryDB</h1>
          <p className="text-[var(--text-secondary)] text-sm">Zero-Knowledge Encrypted Messaging</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--bg-tertiary)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-[var(--danger)] bg-opacity-10 border border-[var(--danger)] text-[var(--danger)] px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-[var(--text-secondary)] text-sm">
            Don't have an account?{" "}
            <button
              onClick={onSwitchToRegister}
              className="text-[var(--accent)] hover:underline font-medium"
            >
              Register
            </button>
          </p>
        </div>

        <div className="mt-6 pt-6 border-t border-[var(--bg-tertiary)]">
          <p className="text-xs text-[var(--text-secondary)] text-center">
            🔐 Your keys are generated locally. EncryDB never sees your private data.
          </p>
        </div>
      </div>
    </div>
  );
}