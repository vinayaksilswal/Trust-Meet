"use client";

import { media, message, type Conversation } from "@conviya/contracts";
import { Field, Notice } from "@conviya/ui";
import {
  ConnectionState, Room, RoomEvent, Track,
  type LocalTrackPublication, type RemoteTrack, type RemoteParticipant,
} from "livekit-client";
import { Flag, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, errorMessage } from "@/lib/client";
import { connectRealtimeKit, type CallControls } from "./realtimekit-call";
import { RandomStudio, RandomTile } from "./random-studio";

const chatTopic = "conviya.chat";
const chatMessage = z.string().trim().min(1).max(500);

type Props = {
  call: Pick<Conversation, "id" | "mode" | "partner" | "expires_at">;
  busy: boolean;
  onEnd: () => void;
  onBlock?: () => void;
  group?: boolean;
  onNext?: () => void;
  nextLabel?: string;
  autoStartMedia?: boolean;
};

export function Call({ call, busy, onEnd, onBlock, onNext, nextLabel = "Next", group = false, autoStartMedia = false }: Props) {
  const [connection, setConnection] = useState<ConnectionState>(ConnectionState.Connecting);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [chat, setChat] = useState<{ mine: boolean; text: string; author?: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [connectedPeer, setConnectedPeer] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const controls = useRef<CallControls | null>(null);
  const remote = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLUListElement>(null);
  const callPath = (group ? "/rooms/" : "/conversations/") + call.id;
  const connected = connection === ConnectionState.Connected;
  const seconds = Math.max(0, Math.ceil((Date.parse(call.expires_at) - clock) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const instance = new Room({ adaptiveStream: true, dynacast: true });
    let active: CallControls | undefined;
    setConnection(ConnectionState.Connecting);
    setMic(false);
    setCamera(false);
    setConnectedPeer(false);
    setAudioBlocked(false);
    setSpeakers([]);
    setError("");
    setControlBusy(autoStartMedia && retry === 0 && call.mode !== "text");
    const elements = new Set<HTMLMediaElement>();

    function attachRemote(track: RemoteTrack) {
      if (controller.signal.aborted) return;
      const target = track.kind === Track.Kind.Video ? remote.current : audio.current;
      if (!target) return;
      const element = track.attach();
      elements.add(element);
      target.appendChild(element);
    }
    function detach(track: RemoteTrack) {
      for (const element of track.detach()) { element.remove(); elements.delete(element); }
    }
    function attachLocal(publication: LocalTrackPublication) {
      if (publication.source !== Track.Source.Camera || !preview.current || !publication.track) return;
      const element = publication.track.attach();
      element.muted = true;
      elements.add(element);
      preview.current.appendChild(element);
    }
    function updatePeers() { setConnectedPeer(instance.remoteParticipants.size > 0); }
    instance.on(RoomEvent.TrackSubscribed, attachRemote);
    instance.on(RoomEvent.TrackUnsubscribed, detach);
    instance.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (participant === instance.localParticipant && publication.source === Track.Source.Microphone) setMic(false);
    });
    instance.on(RoomEvent.LocalTrackPublished, attachLocal);
    instance.on(RoomEvent.LocalTrackUnpublished, publication => {
      for (const element of publication.track?.detach() ?? []) { element.remove(); elements.delete(element); }
    });
    instance.on(RoomEvent.ConnectionStateChanged, setConnection);
    instance.on(RoomEvent.ParticipantConnected, updatePeers);
    instance.on(RoomEvent.ParticipantDisconnected, updatePeers);
    instance.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!instance.canPlaybackAudio));
    instance.on(RoomEvent.DataReceived, (bytes: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (!participant || topic !== chatTopic || bytes.length > 2000) return;
      const parsed = chatMessage.safeParse(new TextDecoder().decode(bytes));
      if (parsed.success) setChat(items => [...items.slice(-199), { mine: false, text: parsed.data, author: participant.name }]);
    });

    async function connect() {
      try {
        const credential = await api(callPath + "/media", media, {}, controller.signal);
        if (controller.signal.aborted) return;
        if (credential.provider === "realtimekit") {
          active = await connectRealtimeKit(credential.token, call.mode, controller.signal, {
            remote: remote.current, preview: preview.current, setConnection, setMic, setCamera, setConnectedPeer,
            setAudioBlocked, setChat,
          });
        } else {
          await instance.connect(credential.url, credential.token, { autoSubscribe: call.mode !== "text" });
          active = {
            setMic: enabled => instance.localParticipant.setMicrophoneEnabled(enabled),
            setCamera: enabled => instance.localParticipant.setCameraEnabled(enabled),
            send: text => instance.localParticipant.publishData(new TextEncoder().encode(text), { reliable: true, topic: chatTopic }),
            startAudio: () => instance.startAudio(),
            setSpeaker: device => instance.switchActiveDevice("audiooutput", device),
            close: () => instance.disconnect(),
          };
          updatePeers();
        }
        if (controller.signal.aborted) { await active.close(); return; }
        controls.current = active;
        if (autoStartMedia && retry === 0 && call.mode !== "text") {
          const results = await Promise.allSettled([
            active.setMic(true),
            ...(call.mode === "video" ? [active.setCamera(true)] : []),
          ]);
          if (controller.signal.aborted) return;
          setMic(results[0].status === "fulfilled");
          if (call.mode === "video") setCamera(results[1].status === "fulfilled");
          if (results.some(result => result.status === "rejected")) {
            setError("A media device could not start. Check permissions and use the call controls to retry.");
          }
        }
        if (call.mode !== "text" && navigator.mediaDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
          if (!controller.signal.aborted) setSpeakers(devices.filter(device => device.kind === "audiooutput" && device.deviceId));
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setConnection(ConnectionState.Disconnected);
        setError(errorMessage(cause));
        await (active?.close() ?? instance.disconnect()).catch(() => undefined);
      } finally {
        if (!controller.signal.aborted) setControlBusy(false);
      }
    }

    void connect();
    return () => {
      controller.abort();
      instance.removeAllListeners();
      for (const element of elements) element.remove();
      if (controls.current === active) controls.current = null;
      void (active?.close() ?? instance.disconnect()).catch(() => undefined);
    };
  }, [autoStartMedia, callPath, call.mode, retry]);

  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [chat]);

  async function toggle(kind: "mic" | "camera") {
    const instance = controls.current;
    if (!instance || !connected) return;
    setControlBusy(true);
    setError("");
    try {
      if (kind === "mic") {
        await instance.setMic(!mic);
        if (controls.current === instance) setMic(!mic);
      } else {
        await instance.setCamera(!camera);
        if (controls.current === instance) setCamera(!camera);
      }
    } catch {
      setError(kind === "mic" ? "Microphone unavailable. Check browser permissions and your input device." :
        "Camera unavailable. Check browser permissions and your camera.");
    } finally { setControlBusy(false); }
  }

  async function send() {
    const instance = controls.current;
    const parsed = chatMessage.safeParse(draft);
    if (!instance || !connected || !connectedPeer || !parsed.success) return;
    try {
      await instance.send(parsed.data);
      setChat(items => [...items.slice(-199), { mine: true, text: parsed.data }]);
      setDraft(value => value === draft ? "" : value);
    } catch { setError("Message could not be sent. Try again."); }
  }

  async function submitReport(category: string) {
    try {
      await api(callPath + "/report", message, { category });
      setReportSaved(true);
      setReportOpen(false);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const callStatus = <>
    <div className="call-status"><h2>{call.partner ?? "Conversation"}</h2><span data-testid="call-clock">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} remaining</span></div>
    <Notice>{connected ? (connectedPeer ? "Connected" : "Connected · Waiting for the other participant") :
      connection === ConnectionState.Disconnected ? "Disconnected" : "Connecting…"}</Notice>
    {error && <Notice error>{error}</Notice>}
    {reportSaved && <Notice>Your report was saved.</Notice>}
  </>;

  const mediaControls = <>
    <div className="action-row">
      {call.mode !== "text" && <button className="button button-outline" disabled={!connected || busy || controlBusy} onClick={() => void toggle("mic")}>
        {mic ? <MicOff size={17} /> : <Mic size={17} />}{mic ? "Mute microphone" : "Enable microphone"}
      </button>}
      {call.mode === "video" && <button className="button button-outline" disabled={!connected || busy || controlBusy} onClick={() => void toggle("camera")}>
        {camera ? <VideoOff size={17} /> : <Video size={17} />}{camera ? "Disable camera" : "Enable camera"}
      </button>}
      {call.mode !== "text" && audioBlocked && <button className="button button-outline" onClick={() => {
        void controls.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => setError("Audio playback is unavailable."));
      }}>Enable audio playback</button>}
      {connection === ConnectionState.Disconnected && seconds > 0 && <button className="button button-outline" onClick={() => setRetry(value => value + 1)}>Reconnect</button>}
      <button className="button button-danger" disabled={busy} onClick={onEnd}><PhoneOff size={17} /> {group ? "Leave call" : "End conversation"}</button>
      {onNext && <button className="button button-outline" disabled={busy} onClick={onNext}>{nextLabel}</button>}
    </div>
    {speakers.length > 0 && typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype &&
      <label className="field" style={{ marginTop: 10 }}>Speaker
        <select defaultValue="" onChange={event => {
          void controls.current?.setSpeaker(event.target.value).catch(() => setError("Could not change speaker."));
        }}><option value="" disabled>Choose an output</option>
          {speakers.map((speaker, index) => <option key={speaker.deviceId} value={speaker.deviceId}>{speaker.label || `Speaker ${index + 1}`}</option>)}</select>
      </label>}
  </>;

  const chatPanel = <>
    <h2>Messages</h2>
    <ul className="chat-log" aria-label="Conversation messages" aria-live="polite" ref={history}>
      {chat.length === 0 && <li>No messages yet.</li>}
      {chat.map((item, index) => <li key={index}><strong>{item.mine ? "You" : item.author || (group ? "Participant" : call.partner)}:</strong> {item.text}</li>)}
    </ul>
    <form className="chat-form" onSubmit={event => { event.preventDefault(); void send(); }}>
      <Field label="Message" name="message" value={draft} placeholder="Type a message…" maxLength={500} onChange={event => setDraft(event.target.value)} required />
      <button className="button button-primary" disabled={!connected || !connectedPeer || !draft.trim()}>Send</button>
    </form>
  </>;

  const safetyControls = <>
    <div className="action-row random-safety-actions">
      <button className="button button-outline" onClick={() => setReportOpen(!reportOpen)} aria-expanded={reportOpen}><Flag size={17} /> Report</button>
      {!group && <button className="button button-outline" onClick={() => setBlockOpen(!blockOpen)} aria-expanded={blockOpen}>Block participant</button>}
    </div>
    {reportOpen && <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      void submitReport(String(new FormData(event.currentTarget).get("category")));
    }}><label className="field">Report reason<select name="category" required>
      <option value="">Select a reason</option><option value="harassment">Harassment</option><option value="sexual_content">Sexual content</option>
      <option value="scam">Scam</option><option value="threat">Threat</option><option value="underage">Suspected underage user</option><option value="other">Other</option>
    </select></label><button className="button button-primary">Submit report</button></form>}
    {blockOpen && <div className="action-row"><p>Blocking ends this conversation and prevents future matches with this person.</p>
      <button className="button button-danger" disabled={busy} onClick={onBlock}>Confirm block</button>
    </div>}
  </>;

  if (group) return <div>
    {callStatus}
    {call.mode === "video" && <div className="video-stage video-group" aria-label="Video stage">
      <span>Camera is off</span><div className="remote" ref={remote} data-testid="remote-video" /><div className="local" ref={preview} data-testid="local-preview" />
    </div>}
    <div ref={audio} data-testid="remote-audio" />
    {mediaControls}
    {chatPanel}
    {safetyControls}
  </div>;

  return <>
    <RandomStudio controls={<>{callStatus}{mediaControls}{safetyControls}</>} side={
      <div className="random-active-chat">{chatPanel}</div>
    }>
      <RandomTile name={call.partner ?? "Your match"} mode={call.mode}
        hint={call.mode === "video" ? "Waiting for their camera" : connectedPeer ? "Your match is here" : "Waiting for your match"}
        feed={call.mode === "video" ? remote : undefined} />
      <RandomTile name="You" mode={call.mode} local
        hint={call.mode === "video" ? "Your camera is off" : call.mode === "audio" ? (mic ? "Microphone on" : "Microphone off") : "Text conversation"}
        feed={call.mode === "video" ? preview : undefined} />
    </RandomStudio>
    <div ref={audio} data-testid="remote-audio" />
  </>;
}
