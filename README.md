# EncryDB — Secure, End-to-End Encrypted Messaging

EncryDB is a privacy-first, zero-knowledge messaging platform where messages are encrypted locally on the user's device and remain unreadable by the server.

## Architecture
- **Zero-Knowledge:** The server stores only encrypted blobs. It has no access to private keys or clear-text content.
- **Identity:** Public-key infrastructure allows users to find and add each other without compromising privacy.
- **P2P Communication:** Voice calls utilize WebRTC for peer-to-peer encrypted transmission, bypassing server storage.

## Tech Stack
- **Frontend:** React / Next.js
- **Backend:** Node.js (Serverless functions via Vercel)
- **Encryption:** WebCrypto API (AES-GCM for messages, RSA/ECDH for key exchange)
- **Real-time:** Socket.io / WebRTC

## Roadmap
1. [ ] Client-side Crypto Module (Public/Private key generation)
2. [ ] Registration & Identity Verification
3. [ ] WebSocket relay for encrypted messages
4. [ ] WebRTC signaling for P2P calls
