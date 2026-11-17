import type { Mode } from "@conviya/contracts";
import { ConnectionState } from "livekit-client";
import type { Dispatch, SetStateAction } from "react";

type ChatItem = { mine: boolean; text: string; author?: string };

export type CallControls = {
  setMic: (enabled: boolean) => Promise<unknown>;
  setCamera: (enabled: boolean) => Promise<unknown>;
  send: (text: string) => Promise<unknown>;
  startAudio: () => Promise<unknown>;
  setSpeaker: (deviceId: string) => Promise<unknown>;
  close: () => Promise<unknown>;
};

type View = {
  remote: HTMLDivElement | null;
  preview: HTMLDivElement | null;
  setConnection: (state: ConnectionState) => void;
  setMic: (enabled: boolean) => void;
  setCamera: (enabled: boolean) => void;
  setConnectedPeer: (connected: boolean) => void;
  setAudioBlocked: (blocked: boolean) => void;
  setChat: Dispatch<SetStateAction<ChatItem[]>>;
};

export async function connectRealtimeKit(token: string, mode: Mode, signal: AbortSignal, view: View): Promise<CallControls> {
  const { default: RealtimeKit } = await import("@cloudflare/realtimekit");
  signal.throwIfAborted();
  const meeting = await RealtimeKit.init({ authToken: token, defaults: { audio: false, video: false } });
  const { self, participants, audio } = meeting;
  const videos = new Map<string, HTMLVideoElement>();
  let closed = false;

  function renderVideo(id: string, target: HTMLDivElement | null, track?: MediaStreamTrack, local = false) {
    let element = videos.get(id);
    if (!track || !target) {
      if (element) { element.srcObject = null; element.remove(); videos.delete(id); }
      return;
    }
    if (!element) {
      element = document.createElement("video");
      element.autoplay = true;
      element.playsInline = true;
      element.muted = local;
      videos.set(id, element);
      target.appendChild(element);
    }
    if ((element.srcObject as MediaStream | null)?.getVideoTracks()[0] !== track) {
      element.srcObject = new MediaStream([track]);
    }
  }

  function syncRemote() {
    if (signal.aborted) return;
    const peers = [...participants.joined.values()].filter(peer => peer.id !== self.id);
    view.setConnectedPeer(peers.length > 0);
    if (mode !== "video") return;
    for (const peer of peers) renderVideo(peer.id, view.remote, peer.videoEnabled ? peer.videoTrack : undefined);
    for (const id of videos.keys()) {
      if (id !== "local" && !participants.joined.has(id)) renderVideo(id, null);
    }
  }

  function syncLocalVideo({ videoEnabled, videoTrack }: { videoEnabled: boolean; videoTrack: MediaStreamTrack }) {
    if (signal.aborted) return;
    view.setCamera(videoEnabled);
    if (mode === "video") renderVideo("local", view.preview, videoEnabled ? videoTrack : undefined, true);
  }
  function syncMic({ audioEnabled }: { audioEnabled: boolean }) { view.setMic(audioEnabled); }
  function joined() { view.setConnection(ConnectionState.Connected); syncRemote(); }
  function left() { view.setConnection(ConnectionState.Disconnected); view.setConnectedPeer(false); }
  function playbackBlocked() { view.setAudioBlocked(true); }
  function receive({ type, payload }: { type: string; payload: import("@cloudflare/realtimekit").BroadcastMessagePayload }) {
    if (signal.aborted || type !== "conviya.chat" || typeof payload.text !== "string") return;
    const text = payload.text.trim();
    if (text && text.length <= 500) {
      view.setChat(items => [...items.slice(-199), { mine: false, text }]);
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    self.off("videoUpdate", syncLocalVideo);
    self.off("audioUpdate", syncMic);
    self.off("roomJoined", joined);
    self.off("roomLeft", left);
    self.off("autoplayError", playbackBlocked);
    participants.joined.off("participantJoined", syncRemote);
    participants.joined.off("participantLeft", syncRemote);
    participants.joined.off("videoUpdate", syncRemote);
    participants.videoSubscribed.off("participantJoined", syncRemote);
    participants.videoSubscribed.off("participantLeft", syncRemote);
    participants.off("broadcastedMessage", receive);
    for (const id of videos.keys()) renderVideo(id, null);
    await meeting.leave();
  }

  try {
    signal.throwIfAborted();
    self.on("videoUpdate", syncLocalVideo);
    self.on("audioUpdate", syncMic);
    self.on("roomJoined", joined);
    self.on("roomLeft", left);
    self.on("autoplayError", playbackBlocked);
    participants.joined.on("participantJoined", syncRemote);
    participants.joined.on("participantLeft", syncRemote);
    participants.joined.on("videoUpdate", syncRemote);
    participants.videoSubscribed.on("participantJoined", syncRemote);
    participants.videoSubscribed.on("participantLeft", syncRemote);
    participants.on("broadcastedMessage", receive);
    await meeting.join();
    signal.throwIfAborted();
    if (!self.roomJoined) throw new Error("Could not join the media room.");
    joined();
  } catch {
    await close().catch(() => undefined);
    signal.throwIfAborted();
    throw new Error("Could not join the media room.");
  }

  return {
    setMic: enabled => enabled ? self.enableAudio() : self.disableAudio(),
    setCamera: enabled => enabled ? self.enableVideo() : self.disableVideo(),
    send: async text => {
      const participantIds = [...participants.joined.keys()].filter(id => id !== self.id);
      if (!participantIds.length) throw new Error("No other participants are connected.");
      await participants.broadcastMessage("conviya.chat", { text }, { participantIds });
    },
    startAudio: () => self.playAudio(),
    setSpeaker: async id => audio.setSpeakerDevice(id),
    close,
  };
}
