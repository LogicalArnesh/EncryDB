// EncryDB Client-Side Zero-Knowledge Crypto Engine
// All encryption and key generation happens in the browser via WebCrypto API.

export class EncryDBCrypto {
  // Generate ECDH key pair for key exchange
  static async generateKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"]
    );
    return keyPair;
  }

  // Export public key to base64 string for sharing with server/friends
  static async exportPublicKey(publicKey) {
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  // Import friend's public key from base64 string
  static async importPublicKey(base64Key) {
    const binaryDer = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
      "spki",
      binaryDer.buffer,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    );
  }

  // Derive shared secret key between User A's private key and User B's public key
  static async deriveSharedKey(privateKey, publicKey) {
    return await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: publicKey },
      privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Encrypt text message using derived AES-GCM shared key
  static async encryptMessage(message, sharedKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      sharedKey,
      data
    );

    return {
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCharCode(...new Uint8Array(iv)))
    };
  }

  // Decrypt ciphertext using derived AES-GCM shared key and IV
  static async decryptMessage(ciphertext, ivBase64, sharedKey) {
    const encryptedData = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));

    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      sharedKey,
      encryptedData
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }
}
