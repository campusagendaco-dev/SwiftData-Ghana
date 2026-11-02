import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mic, MicOff, Volume2, VolumeX, Radio } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InGameVoiceChatProps {
  roomCode: string;
  challengeId?: string;
  mySide: "creator" | "opponent";
  myName: string;
  opponentName: string;
  mode: "free_data" | "p2p" | "ai";
  compact?: boolean;
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

const AI_VOICE_REPLIES = [
  "Chale, I hear you loud and clear! Watch this next move!",
  "Eiii, sharp voice! Let's see if your skill matches the talk!",
  "Haha, no mercy in the Arena today my friend!",
  "Good game chale! Keep your eyes on the board!",
  "Steady hands win the data bundle! Show me what you got!",
];

export const InGameVoiceChat: React.FC<InGameVoiceChatProps> = ({
  roomCode,
  mySide,
  myName,
  opponentName,
  mode,
  compact = false,
}) => {
  const { toast } = useToast();
  const [micEnabled, setMicEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [remoteSpeakerName, setRemoteSpeakerName] = useState<string>(opponentName || "Opponent");
  const [localLevel, setLocalLevel] = useState(0);

  const peerIdRef = useRef<string>(
    `${mySide}-${Math.random().toString(36).slice(2, 9)}`
  );
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const burstIntervalRef = useRef<number | null>(null);
  const webrtcConnectedRef = useRef(false);
  const speakerMutedRef = useRef(false);
  const micMutedRef = useRef(false);
  const lastAiVoiceReplyAtRef = useRef<number>(0);
  const remoteSpeakingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    speakerMutedRef.current = speakerMuted;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = speakerMuted;
    }
  }, [speakerMuted]);

  useEffect(() => {
    micMutedRef.current = micMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !micMuted;
      });
    }
  }, [micMuted]);

  const playBase64AudioBurst = useCallback((base64Data: string, mimeType: string) => {
    if (speakerMutedRef.current) return;
    try {
      const byteChars = atob(base64Data);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const tempAudio = new Audio(url);
      tempAudio.volume = 1.0;
      void tempAudio.play().catch(() => {
        // ignore autoplay block
      });
      tempAudio.onended = () => {
        URL.revokeObjectURL(url);
      };
    } catch {
      // ignore malformed audio burst
    }
  }, []);

  const triggerAiVoiceResponse = useCallback(() => {
    if (mode === "p2p" || speakerMutedRef.current) return;
    const now = Date.now();
    if (now - lastAiVoiceReplyAtRef.current < 14000) return;
    lastAiVoiceReplyAtRef.current = now;

    const line =
      AI_VOICE_REPLIES[Math.floor(Math.random() * AI_VOICE_REPLIES.length)];
    setRemoteSpeakerName(opponentName || "Challenger");
    setIsRemoteSpeaking(true);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(line);
        utter.rate = 1.02;
        utter.pitch = 0.98;
        utter.onend = () => setIsRemoteSpeaking(false);
        utter.onerror = () => setIsRemoteSpeaking(false);
        window.speechSynthesis.speak(utter);
      } catch {
        setTimeout(() => setIsRemoteSpeaking(false), 2600);
      }
    } else {
      setTimeout(() => setIsRemoteSpeaking(false), 2600);
    }
  }, [mode, opponentName]);

  const cleanupPeerConnection = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    webrtcConnectedRef.current = false;
    setWebrtcConnected(false);
  }, []);

  const createOrGetPeerConnection = useCallback(
    (targetPeerId: string) => {
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
      pcRef.current = pc;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate && channelRef.current) {
          void channelRef.current.send({
            type: "broadcast",
            event: "webrtc_ice",
            payload: {
              fromPeerId: peerIdRef.current,
              targetPeerId,
              candidate: ev.candidate.toJSON(),
            },
          });
        }
      };

      pc.ontrack = (ev) => {
        const [remoteStream] = ev.streams;
        if (!remoteStream) return;
        if (!remoteAudioRef.current) {
          const audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          audioEl.setAttribute("playsinline", "true");
          remoteAudioRef.current = audioEl;
        }
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.muted = speakerMutedRef.current;
        void remoteAudioRef.current.play().catch(() => {
          // ignore autoplay error until interaction
        });
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        const connected = state === "connected" || state === "completed";
        webrtcConnectedRef.current = connected;
        setWebrtcConnected(connected);
        if (connected) {
          setPeerConnected(true);
        }
      };

      return pc;
    },
    []
  );

  // Set up Supabase Realtime Signaling Channel for the Room
  useEffect(() => {
    if (!roomCode) return;
    const cleanCode = String(roomCode).trim().toUpperCase();
    const channelName = `arena-voice-${cleanCode}`;

    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "voice_hello" }, async ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        setPeerConnected(true);
        if (payload.senderName) {
          setRemoteSpeakerName(String(payload.senderName));
        }

        // Acknowledge presence back
        void channel.send({
          type: "broadcast",
          event: "voice_ack",
          payload: {
            fromPeerId: peerIdRef.current,
            senderName: myName,
            micEnabled: Boolean(localStreamRef.current),
          },
        });

        // If our mic is active, initiate WebRTC Offer
        if (localStreamRef.current) {
          try {
            cleanupPeerConnection();
            const pc = createOrGetPeerConnection(payload.fromPeerId);
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
            });
            await pc.setLocalDescription(offer);
            void channel.send({
              type: "broadcast",
              event: "webrtc_offer",
              payload: {
                fromPeerId: peerIdRef.current,
                targetPeerId: payload.fromPeerId,
                senderName: myName,
                sdp: pc.localDescription,
              },
            });
          } catch (err) {
            console.warn("[InGameVoiceChat] Offer creation warning:", err);
          }
        }
      })
      .on("broadcast", { event: "voice_ack" }, ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        setPeerConnected(true);
        if (payload.senderName) {
          setRemoteSpeakerName(String(payload.senderName));
        }
      })
      .on("broadcast", { event: "webrtc_offer" }, async ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        setPeerConnected(true);
        if (payload.senderName) {
          setRemoteSpeakerName(String(payload.senderName));
        }
        try {
          cleanupPeerConnection();
          const pc = createOrGetPeerConnection(payload.fromPeerId);
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          void channel.send({
            type: "broadcast",
            event: "webrtc_answer",
            payload: {
              fromPeerId: peerIdRef.current,
              targetPeerId: payload.fromPeerId,
              senderName: myName,
              sdp: pc.localDescription,
            },
          });
        } catch (err) {
          console.warn("[InGameVoiceChat] Offer answer warning:", err);
        }
      })
      .on("broadcast", { event: "webrtc_answer" }, async ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        setPeerConnected(true);
        try {
          if (pcRef.current && payload.sdp) {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription(payload.sdp)
            );
          }
        } catch (err) {
          console.warn("[InGameVoiceChat] Set remote answer warning:", err);
        }
      })
      .on("broadcast", { event: "webrtc_ice" }, async ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        try {
          if (pcRef.current && payload.candidate) {
            await pcRef.current.addIceCandidate(
              new RTCIceCandidate(payload.candidate)
            );
          }
        } catch {
          // ignore benign ICE race
        }
      })
      .on("broadcast", { event: "speaking_state" }, ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        setPeerConnected(true);
        if (payload.senderName) {
          setRemoteSpeakerName(String(payload.senderName));
        }
        setIsRemoteSpeaking(Boolean(payload.speaking));
        if (remoteSpeakingTimeoutRef.current) {
          window.clearTimeout(remoteSpeakingTimeoutRef.current);
        }
        if (payload.speaking) {
          remoteSpeakingTimeoutRef.current = window.setTimeout(() => {
            setIsRemoteSpeaking(false);
          }, 1800);
        }
      })
      .on("broadcast", { event: "voice_burst" }, ({ payload }) => {
        if (!payload || payload.fromPeerId === peerIdRef.current) return;
        // Play fallback audio burst if direct WebRTC stream is not yet active
        if (!webrtcConnectedRef.current && payload.audioBase64) {
          setPeerConnected(true);
          if (payload.senderName) {
            setRemoteSpeakerName(String(payload.senderName));
          }
          setIsRemoteSpeaking(true);
          playBase64AudioBurst(payload.audioBase64, payload.mimeType || "audio/webm");
          if (remoteSpeakingTimeoutRef.current) {
            window.clearTimeout(remoteSpeakingTimeoutRef.current);
          }
          remoteSpeakingTimeoutRef.current = window.setTimeout(() => {
            setIsRemoteSpeaking(false);
          }, 1600);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.send({
            type: "broadcast",
            event: "voice_hello",
            payload: {
              fromPeerId: peerIdRef.current,
              senderName: myName,
              side: mySide,
              micEnabled: Boolean(localStreamRef.current),
            },
          });
        }
      });

    return () => {
      if (remoteSpeakingTimeoutRef.current) {
        window.clearTimeout(remoteSpeakingTimeoutRef.current);
      }
      cleanupPeerConnection();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [
    roomCode,
    myName,
    mySide,
    cleanupPeerConnection,
    createOrGetPeerConnection,
    playBase64AudioBurst,
  ]);

  const stopMicrophone = useCallback(() => {
    if (meterIntervalRef.current) {
      window.clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }
    if (burstIntervalRef.current) {
      window.clearInterval(burstIntervalRef.current);
      burstIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    cleanupPeerConnection();
    setMicEnabled(false);
    setMicMuted(false);
    setIsLocalSpeaking(false);
    setLocalLevel(0);

    if (channelRef.current) {
      void channelRef.current.send({
        type: "broadcast",
        event: "speaking_state",
        payload: {
          fromPeerId: peerIdRef.current,
          senderName: myName,
          speaking: false,
        },
      });
    }
  }, [cleanupPeerConnection, myName]);

  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, [stopMicrophone]);

  const startMicrophone = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({
        title: "Microphone Not Supported",
        description: "Your browser does not support live microphone access.",
        variant: "destructive",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;
      setMicEnabled(true);
      setMicMuted(false);

      // Set up Web Audio AnalyserNode for real-time voice level & speaking indicator
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      let prevSpeaking = false;

      meterIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current || micMutedRef.current) {
          setLocalLevel(0);
          setIsLocalSpeaking(false);
          return;
        }
        analyserRef.current.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
        }
        const avg = sum / freqData.length;
        const normalized = Math.min(100, Math.round((avg / 65) * 100));
        setLocalLevel(normalized);

        const speakingNow = normalized >= 14;
        setIsLocalSpeaking(speakingNow);

        if (speakingNow !== prevSpeaking) {
          prevSpeaking = speakingNow;
          if (channelRef.current) {
            void channelRef.current.send({
              type: "broadcast",
              event: "speaking_state",
              payload: {
                fromPeerId: peerIdRef.current,
                senderName: myName,
                speaking: speakingNow,
              },
            });
          }
          if (!speakingNow && mode !== "p2p") {
            triggerAiVoiceResponse();
          }
        }
      }, 110);

      // Set up automatic low-latency audio burst relay fallback when WebRTC UDP is not yet established
      if (typeof MediaRecorder !== "undefined") {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

        const startBurstCycle = () => {
          if (
            !localStreamRef.current ||
            micMutedRef.current ||
            webrtcConnectedRef.current
          ) {
            return;
          }
          try {
            const recorder = mimeType
              ? new MediaRecorder(localStreamRef.current, { mimeType })
              : new MediaRecorder(localStreamRef.current);
            const chunks: BlobPart[] = [];
            recorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) {
                chunks.push(e.data);
              }
            };
            recorder.onstop = () => {
              if (
                chunks.length === 0 ||
                micMutedRef.current ||
                webrtcConnectedRef.current ||
                !channelRef.current
              ) {
                return;
              }
              const blob = new Blob(chunks, {
                type: recorder.mimeType || "audio/webm",
              });
              if (blob.size < 600) return;
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Url = String(reader.result || "");
                const base64Data = base64Url.split(",")[1];
                if (base64Data && channelRef.current) {
                  void channelRef.current.send({
                    type: "broadcast",
                    event: "voice_burst",
                    payload: {
                      fromPeerId: peerIdRef.current,
                      senderName: myName,
                      mimeType: blob.type,
                      audioBase64: base64Data,
                    },
                  });
                }
              };
              reader.readAsDataURL(blob);
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
            window.setTimeout(() => {
              if (recorder.state !== "inactive") {
                try {
                  recorder.stop();
                } catch {
                  // ignore
                }
              }
            }, 1350);
          } catch {
            // ignore recorder fallback error
          }
        };

        burstIntervalRef.current = window.setInterval(startBurstCycle, 1450);
      }

      // Announce Open Mic ready so opponent connects immediately
      if (channelRef.current) {
        void channelRef.current.send({
          type: "broadcast",
          event: "voice_hello",
          payload: {
            fromPeerId: peerIdRef.current,
            senderName: myName,
            side: mySide,
            micEnabled: true,
          },
        });
      }

      toast({
        title: "🎙️ Open Mic Activated!",
        description:
          mode === "p2p"
            ? `Live voice chat is ON in Room #${roomCode}. Speak freely with ${opponentName || "your opponent"}!`
            : `Open Mic is ON! Talk with ${opponentName} during the match!`,
      });
    } catch (err: any) {
      toast({
        title: "Could Not Access Microphone",
        description:
          err?.message ||
          "Please allow microphone permission in your browser to use Open Mic voice chat.",
        variant: "destructive",
      });
    }
  };

  const handleTogglePrimaryMic = () => {
    if (!micEnabled) {
      void startMicrophone();
    } else {
      setMicMuted((prev) => !prev);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      {/* Primary Open Mic Toggle Button */}
      <button
        type="button"
        onClick={handleTogglePrimaryMic}
        className={`h-6 px-2 rounded-full border text-[9px] sm:text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
          !micEnabled
            ? "bg-rose-500/20 hover:bg-rose-500/30 border-rose-400/50 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.25)]"
            : micMuted
            ? "bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/50 text-amber-300"
            : isLocalSpeaking
            ? "bg-emerald-500 text-slate-950 border-white ring-2 ring-emerald-400/70 shadow-[0_0_16px_rgba(16,185,129,0.7)]"
            : "bg-emerald-500/25 hover:bg-emerald-500/35 border-emerald-400/60 text-emerald-200"
        }`}
        title={
          !micEnabled
            ? "Tap to turn ON Open Mic for instant voice chat"
            : micMuted
            ? "Mic is Muted — Tap to Unmute"
            : "Open Mic is LIVE — Tap to Mute"
        }
      >
        {!micEnabled ? (
          <>
            <Mic className="w-3 h-3 text-rose-300 animate-pulse" />
            <span>🎙️ Open Mic</span>
          </>
        ) : micMuted ? (
          <>
            <MicOff className="w-3 h-3 text-amber-300" />
            <span>Muted</span>
          </>
        ) : (
          <>
            <Radio className="w-3 h-3 animate-spin" />
            <span>{isLocalSpeaking ? `Speaking (${localLevel}%)` : "Mic LIVE"}</span>
          </>
        )}
      </button>

      {/* Disconnect Mic Button when active */}
      {micEnabled && (
        <button
          type="button"
          onClick={stopMicrophone}
          className="h-6 px-1.5 rounded-full bg-slate-900/90 hover:bg-rose-950 border border-white/15 text-[8px] font-bold text-slate-300 hover:text-rose-300 cursor-pointer"
          title="Turn Off Open Mic"
        >
          Off
        </button>
      )}

      {/* Speaker Mute / Unmute Button */}
      <button
        type="button"
        onClick={() => setSpeakerMuted((prev) => !prev)}
        className={`h-6 w-6 rounded-full border flex items-center justify-center transition-all cursor-pointer shrink-0 ${
          speakerMuted
            ? "bg-slate-900 border-white/15 text-slate-500"
            : isRemoteSpeaking
            ? "bg-amber-400 text-slate-950 border-white animate-bounce"
            : "bg-white/10 hover:bg-white/15 border-white/15 text-emerald-300"
        }`}
        title={speakerMuted ? "Unmute Opponent Voice" : "Mute Opponent Voice"}
      >
        {speakerMuted ? (
          <VolumeX className="w-3 h-3" />
        ) : (
          <Volume2 className="w-3 h-3" />
        )}
      </button>

      {/* Remote Speaking / Peer Voice Status Pill */}
      {(isRemoteSpeaking || (!compact && peerConnected)) && (
        <span
          className={`px-2 py-0.5 rounded-full text-[8px] sm:text-[9px] font-black flex items-center gap-1 border ${
            isRemoteSpeaking
              ? "bg-amber-500/25 border-amber-400 text-amber-200 animate-pulse"
              : "bg-emerald-500/15 border-emerald-400/40 text-emerald-300"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isRemoteSpeaking ? "bg-amber-400 animate-ping" : "bg-emerald-400"
            }`}
          />
          <span className="truncate max-w-[90px]">
            {isRemoteSpeaking
              ? `🗣️ ${remoteSpeakerName}`
              : webrtcConnected
              ? "HD Voice"
              : "Voice Ready"}
          </span>
        </span>
      )}
    </div>
  );
};

export default InGameVoiceChat;
