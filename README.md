# EncryDB — Secure, End-to-End Encrypted Messaging

EncryDB is a privacy-first, zero-knowledge messaging platform where messages are encrypted locally on the user's device and remain unreadable by the server.

## 📜 License
This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

## 🏗️ Architecture
- **Zero-Knowledge:** The server stores only encrypted blobs. It has no access to private keys or clear-text content.
- **Identity:** Public-key infrastructure allows users to find and add each other without compromising privacy.
- **P2P Communication:** Voice calls utilize WebRTC for peer-to-peer encrypted transmission, bypassing server storage.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- A [Vercel](https://vercel.com/) account
- Basic knowledge of React/Next.js

### Setup Instructions
1. **Clone the repository:**
   ```bash
   git clone https://github.com/LogicalArnesh/EncryDB.git
   cd EncryDB
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Create a `.env.local` file in the root directory:
   ```text
   # Add your DB connection string or API keys here as needed
   ```

4. **Run Development Server:**
   ```bash
   npm run dev
   ```

5. **Deploy to Vercel:**
   ```bash
   vercel
   ```

## 🔐 Security Details
- **Encryption:** Uses `WebCrypto API` (AES-GCM for message content, ECDH for secure key exchange).
- **Communication:** WebRTC for P2P encrypted audio.
- **Identity:** Public/Private key pairs generated on the client side during registration.

## 🛠️ Roadmap
- [ ] UI/UX Interface (Discord-like channels/groups)
- [ ] User Verification Flow (Email-based identity)
- [ ] WebSocket relay implementation
- [ ] WebRTC signaling server refinement