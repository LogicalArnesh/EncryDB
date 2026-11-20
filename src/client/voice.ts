import type { Peer, Signal } from '../shared/types'
import { api, post } from './api'

type Callbacks = {
  onPeers: (peers: Peer[]) => void
  onStatus: (status: 'idle' | 'joining' | 'connected' | 'error') => void
  onError: (message: string) => void
}

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

/**
 * Group voice over WebRTC. Audio is peer-to-peer and DTLS-SRTP encrypted; the
 * server only relays session descriptions and ICE candidates.
 */
export class VoiceSession {
  private channelId = ''
  private peerId = ''
  private local: MediaStream | null = null
  private sockets = new Map<string, RTCPeerConnection>()
  private audio = new Map<string, HTMLAudioElement>()
  private queue = new Map<string, RTCIceCandidateInit[]>()
  private timer: number | undefined
  private lastSignal = 0
  private muted = false
  private deafened = false
  private closed = false

  constructor(private callbacks: Callbacks) {}

  get isMuted() {
    return this.muted
  }

  async start(channelId: string, muted: boolean) {
    this.closed = false
    this.channelId = channelId
    this.muted = muted
    this.callbacks.onStatus('joining')
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch {
      this.callbacks.onStatus('error')
      this.callbacks.onError(
        'Microphone access was blocked. Allow it in your browser to talk.',
      )
      return
    }
    this.local.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    const joined = await post<{ peerId: string }>(
      `/api/channels/${channelId}/voice/join`,
      { muted },
    )
    this.peerId = joined.peerId
    this.callbacks.onStatus('connected')
    void this.tick()
    this.timer = window.setInterval(() => void this.tick(), 1200)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.local?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened
    this.audio.forEach((element) => {
      element.muted = deafened
    })
  }

  async leave() {
    this.closed = true
    if (this.timer) window.clearInterval(this.timer)
    this.timer = undefined
    this.sockets.forEach((socket) => socket.close())
    this.sockets.clear()
    this.audio.forEach((element) => {
      element.srcObject = null
      element.remove()
    })
    this.audio.clear()
    this.local?.getTracks().forEach((track) => track.stop())
    this.local = null
    if (this.peerId)
      await post(`/api/channels/${this.channelId}/voice/leave`, {
        peerId: this.peerId,
      }).catch(() => undefined)
    this.peerId = ''
    this.callbacks.onPeers([])
    this.callbacks.onStatus('idle')
  }

  private async tick() {
    if (this.closed || !this.peerId) return
    try {
      const beat = await post<{ peers: Peer[] }>(
        `/api/channels/${this.channelId}/voice/heartbeat`,
        { peerId: this.peerId, muted: this.muted },
      )
      if (this.closed) return
      const peers = beat.peers.filter((peer) => peer.peerId !== this.peerId)
      this.callbacks.onPeers(beat.peers)
      const live = new Set(peers.map((peer) => peer.peerId))
      for (const [id, socket] of this.sockets) {
        if (!live.has(id)) {
          socket.close()
          this.sockets.delete(id)
          this.audio.get(id)?.remove()
          this.audio.delete(id)
        }
      }
      for (const peer of peers) {
        // Deterministic offerer avoids glare: the lower peer id calls out.
        if (this.peerId < peer.peerId && !this.sockets.has(peer.peerId)) {
          await this.connect(peer.peerId, true)
        }
      }
      const incoming = await api<{ signals: Signal[] }>(
        `/api/channels/${this.channelId}/voice/signals?peerId=${this.peerId}&after=${this.lastSignal}`,
      )
      for (const signal of incoming.signals) {
        this.lastSignal = Math.max(this.lastSignal, signal.id)
        await this.handle(signal)
      }
    } catch {
      // Transient polling failures are retried on the next tick.
    }
  }

  private async connect(peerId: string, offerer: boolean) {
    const socket = new RTCPeerConnection(ICE)
    this.sockets.set(peerId, socket)
    this.local?.getTracks().forEach((track) => {
      this.local && socket.addTrack(track, this.local)
    })
    socket.onicecandidate = (event) => {
      if (event.candidate)
        void this.signal(peerId, 'ice', JSON.stringify(event.candidate))
    }
    socket.ontrack = (event) => {
      let element = this.audio.get(peerId)
      if (!element) {
        element = document.createElement('audio')
        element.autoplay = true
        element.style.display = 'none'
        document.body.appendChild(element)
        this.audio.set(peerId, element)
      }
      element.srcObject = event.streams[0]
      element.muted = this.deafened
    }
    if (offerer) {
      const offer = await socket.createOffer()
      await socket.setLocalDescription(offer)
      await this.signal(peerId, 'offer', JSON.stringify(offer))
    }
    return socket
  }

  private async signal(to: string, kind: string, payload: string) {
    if (!this.peerId) return
    await post(`/api/channels/${this.channelId}/voice/signal`, {
      peerId: this.peerId,
      to,
      kind,
      payload,
    }).catch(() => undefined)
  }

  private async handle(signal: Signal) {
    if (signal.kind === 'offer') {
      const socket =
        this.sockets.get(signal.from) ?? (await this.connect(signal.from, false))
      await socket.setRemoteDescription(JSON.parse(signal.payload))
      const queue = this.queue.get(signal.from) ?? []
      for (const candidate of queue) await socket.addIceCandidate(candidate)
      this.queue.delete(signal.from)
      const answer = await socket.createAnswer()
      await socket.setLocalDescription(answer)
      await this.signal(signal.from, 'answer', JSON.stringify(answer))
      return
    }
    if (signal.kind === 'answer') {
      const socket = this.sockets.get(signal.from)
      if (!socket) return
      await socket.setRemoteDescription(JSON.parse(signal.payload))
      const queue = this.queue.get(signal.from) ?? []
      for (const candidate of queue) await socket.addIceCandidate(candidate)
      this.queue.delete(signal.from)
      return
    }
    if (signal.kind === 'ice') {
      const socket = this.sockets.get(signal.from)
      const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit
      if (!socket || !socket.remoteDescription) {
        const queue = this.queue.get(signal.from) ?? []
        queue.push(candidate)
        this.queue.set(signal.from, queue)
        return
      }
      await socket.addIceCandidate(candidate).catch(() => undefined)
    }
  }
}
