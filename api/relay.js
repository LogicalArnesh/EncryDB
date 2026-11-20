// EncryDB Serverless API Route / Signaling Handler
// Zero-Knowledge Relay Server (for Vercel deployment)
// The server ONLY stores/relays encrypted payloads and public keys.

export default async function handler(req, res) {
  const { method } = req;

  if (method === "POST") {
    const { action, payload } = req.body;

    switch (action) {
      case "REGISTER_USER":
        // Save user handle and public key (No private key, no clear password)
        // Payload: { handle, emailHash, publicKeyBase64 }
        return res.status(200).json({ status: "success", message: "User public key registered." });

      case "SEND_ENCRYPTED_MESSAGE":
        // Relay encrypted payload to recipient
        // Payload: { senderHandle, recipientHandle, ciphertext, iv, timestamp }
        return res.status(200).json({ status: "success", message: "Encrypted payload relayed." });

      case "LOOKUP_USER":
        // Return recipient's public key for key exchange
        // Payload: { targetHandle }
        return res.status(200).json({ status: "success", publicKeyBase64: "EXAMPLE_PUBLIC_KEY_STRING" });

      default:
        return res.status(400).json({ error: "Invalid action" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}