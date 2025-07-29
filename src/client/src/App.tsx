import React, { useState, useEffect, useRef } from "react";
import io, { Socket } from "socket.io-client";
import "./App.css";

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

interface AudioRefs {
  socket: Socket | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
  volumeFrame: number | undefined;
  mediaRecorder: MediaRecorder | null;
}

function App() {
  // Room state
  const [roomId, setRoomId] = useState<string>("");
  const [joinRoomId, setJoinRoomId] = useState<string>("");

  // Audio state
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string>("");
  const [inputVolume, setInputVolume] = useState<number>(0);
  const [outputVolume, setOutputVolume] = useState<number>(0);

  // Refs
  const socketRef = useRef<AudioRefs["socket"]>(null);
  const audioContextRef = useRef<AudioRefs["audioContext"]>(null);
  const analyserRef = useRef<AudioRefs["analyser"]>(null);
  const outputAnalyserRef = useRef<AudioRefs["outputAnalyser"]>(null);
  const volumeFrameRef = useRef<AudioRefs["volumeFrame"]>(undefined);

  // Socket.io setup
  useEffect(() => {
    // Initialize socket connection with relative URL in production
    socketRef.current = io(
      process.env.NODE_ENV === "production" ? "/" : "http://localhost:5000"
    );

    // Connection event handlers
    socketRef.current.on("connect", () => {
      console.log("Connected to server");
    });

    socketRef.current.on("disconnect", () => {
      console.log("Disconnected from server");
    });

    socketRef.current.on("connect_error", (error: Error) => {
      console.error("Socket connection error:", error);
      setMicrophoneError(
        "Connection error. Please check your internet connection."
      );
    });

    // Room event handlers
    socketRef.current.on("room-created", (newRoomId: string) => {
      console.log("Room created:", newRoomId);
      setRoomId(newRoomId);
    });

    socketRef.current.on("user-joined", (userId: string) => {
      console.log(`User joined: ${userId}`);
    });

    socketRef.current.on("voice", async (audioData: ArrayBuffer) => {
      try {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        const audio = new Audio();
        const blob = new Blob([audioData], { type: mimeType });
        audio.src = URL.createObjectURL(blob);

        // Initialize AudioContext if it doesn't exist
        if (!audioContextRef.current) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          audioContextRef.current = new AudioContext();
        }

        if (audioContextRef.current.state === "closed") {
          console.error("AudioContext is closed");
          return;
        }

        if (audioContextRef.current.state === "suspended") {
          await audioContextRef.current.resume();
        }

        // Create a new analyser node for this audio stream
        const playbackAnalyser = audioContextRef.current.createAnalyser();
        playbackAnalyser.fftSize = 256;
        playbackAnalyser.smoothingTimeConstant = 0.5;

        // Create and connect the source
        const source = audioContextRef.current.createMediaElementSource(audio);
        source.connect(playbackAnalyser);
        playbackAnalyser.connect(audioContextRef.current.destination);

        const dataArray = new Float32Array(playbackAnalyser.frequencyBinCount);
        let animationFrame: number;

        const updateVolume = () => {
          playbackAnalyser.getFloatTimeDomainData(dataArray);
          const volume = Math.max(...Array.from(dataArray).map(Math.abs));
          setOutputVolume(volume);

          if (!audio.ended) {
            animationFrame = requestAnimationFrame(updateVolume);
          } else {
            setOutputVolume(0);
          }
        };

        audio.onplay = () => {
          console.log("Playing received audio");
          updateVolume();
        };

        audio.onended = () => {
          console.log("Finished playing received audio");
          cancelAnimationFrame(animationFrame);
          URL.revokeObjectURL(audio.src);
          // Disconnect and clean up nodes
          source.disconnect();
          playbackAnalyser.disconnect();
        };

        await audio.play();
      } catch (error) {
        console.error("Error handling received audio:", error);
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Audio setup
  useEffect(() => {
    let isActive = true;
    let volumeFrame: number | undefined;

    const initializeAudio = async () => {
      if (audioStream) return;

      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (!isActive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Create audio context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContext();

        // Create and configure analyzers
        const inputAnalyzer = context.createAnalyser();
        const outputAnalyzer = context.createAnalyser();

        inputAnalyzer.fftSize = 256;
        outputAnalyzer.fftSize = 256;
        inputAnalyzer.smoothingTimeConstant = 0.5;
        outputAnalyzer.smoothingTimeConstant = 0.5;

        // Connect input source to analyzer
        const source = context.createMediaStreamSource(stream);
        source.connect(inputAnalyzer);

        // Update refs and state
        audioContextRef.current = context;
        analyserRef.current = inputAnalyzer;
        outputAnalyserRef.current = outputAnalyzer;
        setAudioStream(stream);
        setMicrophoneError("");

        // Set up volume monitoring
        const dataArray = new Float32Array(inputAnalyzer.frequencyBinCount);

        const updateVolume = () => {
          if (!isActive || !inputAnalyzer) return;

          inputAnalyzer.getFloatTimeDomainData(dataArray);
          const volume = Math.max(...Array.from(dataArray).map(Math.abs));
          setInputVolume(volume);
          volumeFrame = requestAnimationFrame(updateVolume);
          volumeFrameRef.current = volumeFrame;
        };

        updateVolume();
      } catch (error) {
        if (!isActive) return;

        console.error("Error accessing microphone:", error);
        if (error instanceof Error) {
          setMicrophoneError(
            error.name === "NotAllowedError"
              ? "Microphone access denied. Please allow microphone access in your browser settings."
              : "Error accessing microphone. Please ensure your microphone is connected and working."
          );
        }
        setAudioStream(null);
      }
    };

    initializeAudio();

    return () => {
      isActive = false;

      if (volumeFrame) {
        cancelAnimationFrame(volumeFrame);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [audioStream]);

  const createRoom = () => {
    socketRef.current?.emit("create-room");
  };

  const joinRoom = () => {
    if (joinRoomId) {
      socketRef.current?.emit("join-room", joinRoomId);
      setRoomId(joinRoomId);
    }
  };

  const startTransmitting = (): MediaRecorder | undefined => {
    if (!audioStream) {
      console.error("No audio stream available");
      return undefined;
    }

    try {
      // Check supported MIME types
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg;codecs=opus";

      console.log("Using MIME type:", mimeType);

      const mediaRecorder = new MediaRecorder(audioStream, {
        mimeType,
        bitsPerSecond: 32000,
      });

      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          console.log("Recorded chunk size:", event.data.size);
        }
      };

      mediaRecorder.onstop = () => {
        if (audioChunks.length === 0) {
          console.log("No audio chunks recorded");
          return;
        }

        console.log("Processing", audioChunks.length, "audio chunks");
        const audioBlob = new Blob(audioChunks, { type: mimeType });

        audioBlob
          .arrayBuffer()
          .then((buffer) => {
            if (socketRef.current?.connected) {
              console.log("Sending voice data, size:", buffer.byteLength);
              socketRef.current.emit("voice", buffer);
            } else {
              console.error("Socket not connected");
            }
          })
          .catch((error) => {
            console.error("Error converting blob to buffer:", error);
          });
      };

      mediaRecorder.start(100);
      console.log("Started recording");
      return mediaRecorder;
    } catch (error) {
      console.error("Error starting media recorder:", error);
      return undefined;
    }
  };

  const handlePushToTalk = () => {
    if (!audioStream) {
      console.error("No audio stream available");
      setMicrophoneError("Please allow microphone access to talk");
      return;
    }

    if (!socketRef.current?.connected) {
      console.error("Not connected to server");
      return;
    }

    const mediaRecorder = startTransmitting();
    if (!mediaRecorder) {
      console.error("Failed to start recording");
      return;
    }

    console.log("Push to talk activated");

    const handleMouseUp = () => {
      console.log("Stopping recording");
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className="App">
      {roomId && (
        <div className="volume-meters">
          <div className="volume-meter">
            <div className="volume-label">Input Volume</div>
            <div
              className="volume-bar"
              style={{ width: `${Math.min(inputVolume * 100, 100)}%` }}
            />
          </div>
          <div className="volume-meter">
            <div className="volume-label">Output Volume</div>
            <div
              className="volume-bar"
              style={{ width: `${Math.min(outputVolume * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
      <div className="container">
        {!roomId ? (
          <div className="join-container">
            <button onClick={createRoom}>Create New Room</button>
            <div className="join-room">
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="Room Code"
              />
              <button onClick={joinRoom}>Join Room</button>
            </div>
          </div>
        ) : (
          <div className="room-container">
            <h2>Room Code: {roomId}</h2>
            <p>Share this code with your friends</p>
            {microphoneError && <p className="error">{microphoneError}</p>}
            <button className="talk-button" onMouseDown={handlePushToTalk}>
              Press and Hold to Talk
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
