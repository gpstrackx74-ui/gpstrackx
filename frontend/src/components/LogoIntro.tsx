import React, { useEffect, useRef, useState } from 'react';

interface LogoIntroProps {
  onComplete: () => void;
  videoSrc?: string;
}

export const LogoIntro: React.FC<LogoIntroProps> = ({ 
  onComplete, 
  videoSrc = '/logoweb.mp4' 
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completedRef = useRef(false);
  const animFrameIdRef = useRef<number | null>(null);

  const finishIntro = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
    }
    setIsExiting(true);
    setTimeout(() => {
      onComplete();
    }, 350); // Fast, seamless reveal
  };

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Increased playback speed (snappy and punchy ~2.85x speed)
    const TARGET_SPEED = 2.85;
    video.playbackRate = TARGET_SPEED;

    const applySpeed = () => {
      if (video && video.playbackRate !== TARGET_SPEED) {
        video.playbackRate = TARGET_SPEED;
      }
    };

    video.addEventListener('play', applySpeed);
    video.addEventListener('playing', applySpeed);
    video.addEventListener('loadedmetadata', applySpeed);

    // Frame rendering with real-time transparent background keying
    const renderLoop = () => {
      if (completedRef.current) return;

      if (video.readyState >= 2 && !video.paused && !video.ended) {
        const width = video.videoWidth || 496;
        const height = video.videoHeight || 368;

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        // 1. Draw raw frame from video
        ctx.drawImage(video, 0, 0, width, height);

        // 2. Read pixel buffer for background transparency processing
        try {
          const imgData = ctx.getImageData(0, 0, width, height);
          const data = imgData.data;

          // Sample corner pixels to detect the exact video background color
          const tlR = data[0], tlG = data[1], tlB = data[2];
          const trIdx = (width - 1) * 4;
          const trR = data[trIdx], trG = data[trIdx + 1], trB = data[trIdx + 2];
          const bgR = (tlR + trR) / 2;
          const bgG = (tlG + trG) / 2;
          const bgB = (tlB + trB) / 2;

          const tolerance = 32;
          const feather = 18;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Color distance to background
            const diff = Math.max(Math.abs(r - bgR), Math.abs(g - bgG), Math.abs(b - bgB));
            // Near-white detection
            const isNearWhite = (r >= 236 && g >= 236 && b >= 236);

            if (diff <= tolerance || isNearWhite) {
              // 100% transparent
              data[i + 3] = 0;
            } else if (diff < tolerance + feather) {
              // Anti-aliased feathering on edges
              const factor = (diff - tolerance) / feather;
              data[i + 3] = Math.round(data[i + 3] * factor);
            }
          }

          // 3. Put transparent frame back onto canvas
          ctx.putImageData(imgData, 0, 0);
        } catch {
          // If cross-origin or buffer issue, fallback to native canvas draw
        }
      }

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);

    const handleEnded = () => {
      finishIntro();
    };
    video.addEventListener('ended', handleEnded);

    // Play video
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          applySpeed();
        })
        .catch(() => {
          // If browser restricts autoplay
        });
    }

    // Fallback safety timer: At ~2.85x speed, 5s video finishes in ~1.75s.
    // 2.2s guarantees user is never stuck
    const safetyTimer = setTimeout(() => {
      finishIntro();
    }, 2200);

    // Keyboard shortcut to skip
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        finishIntro();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      video.removeEventListener('play', applySpeed);
      video.removeEventListener('playing', applySpeed);
      video.removeEventListener('loadedmetadata', applySpeed);
      video.removeEventListener('ended', handleEnded);
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(safetyTimer);
    };
  }, []);

  return (
    <div 
      onClick={finishIntro}
      className={`fixed inset-0 z-[9999] bg-white flex items-center justify-center select-none overflow-hidden cursor-pointer transition-opacity duration-350 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* 100% Pure White Canvas with Chroma-Keyed Transparent Video Frame */}
      <div className="relative w-full max-w-[500px] px-6 flex items-center justify-center [mix-blend-mode:multiply]">
        {/* Hidden source video element used for streaming frames */}
        <video
          ref={videoRef}
          src={videoSrc}
          muted
          autoPlay
          playsInline
          preload="auto"
          className="hidden pointer-events-none"
        />

        {/* Real-time Chroma-Keyed Canvas: video background rendered 100% transparent */}
        <canvas
          ref={canvasRef}
          className="w-full h-auto object-contain pointer-events-none"
        />
      </div>
    </div>
  );
};
