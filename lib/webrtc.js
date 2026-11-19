// WebRTC Peer-to-Peer Voice Call Handler for EncryDB
// Audio data travels directly P2P between users using DTLS-SRTP encryption.

export class VoiceCallSession {
  constructor(localAudioElement, remoteAudioElement, sendSignalingMessage) {
    self.peerConnection = null;
    self.localStream = null;
    self.localAudio = localAudioElement;
    self.remoteAudio = remoteAudioElement;
    self.sendSignalingMessage = sendSignalingMessage;
  }

  async initCall() {
    const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    this.peerConnection = new RTCPeerConnection(configuration);

    // Get microphone access
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.localStream.getTracks().forEach(track => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    // Handle incoming audio stream
    this.peerConnection.ontrack = (event) => {
      if (this.remoteAudio) {
        this.remoteAudio.srcObject = event.streams[0];
      }
    };

    // ICE candidates exchange
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({ type: "ICE_CANDIDATE", candidate: event.candidate });
      }
    };
  }

  async startCall() {
    await this.initCall();
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    this.sendSignalingMessage({ type: "SDP_OFFER", offer: offer });
  }

  async handleIncomingOffer(offer) {
    await this.initCall();
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    this.sendSignalingMessage({ type: "SDP_ANSWER", answer: answer });
  }

  async handleIncomingAnswer(answer) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async handleIceCandidate(candidate) {
    if (this.peerConnection) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  endCall() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
  }
}
