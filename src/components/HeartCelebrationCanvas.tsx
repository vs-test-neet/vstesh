import React, { useEffect, useRef } from 'react';

interface HeartParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  vRot: number;
  opacity: number;
  emoji: string;
}

const HEART_EMOJIS = ['❤️', '💖', '💗', '💓', '💘', '💝', '✨'];

export const HeartCelebrationCanvas: React.FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: HeartParticle[] = Array.from({ length: 58 }, () => ({
      x: Math.random() * canvas.width,
      y: canvas.height + 20 + Math.random() * 240,
      vx: (Math.random() - 0.5) * 2.6,
      vy: -(3.2 + Math.random() * 4.5),
      size: 22 + Math.random() * 20,
      rotation: (Math.random() - 0.5) * 0.5,
      vRot: (Math.random() - 0.5) * 0.02,
      opacity: 0.95,
      emoji: HEART_EMOJIS[Math.floor(Math.random() * HEART_EMOJIS.length)],
    }));

    const startTime = performance.now();
    const DURATION = 5000;
    let rafId = 0;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (elapsed > DURATION) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const fadeMultiplier = elapsed > 3800 ? Math.max(0, 1 - (elapsed - 3800) / 1200) : 1;

      for (const p of particles) {
        p.x += p.vx + Math.sin(elapsed * 0.003 + p.size) * 0.6;
        p.y += p.vy;
        p.rotation += p.vRot;

        if (p.y < -50 && elapsed < 3200) {
          p.y = canvas.height + 30;
          p.x = Math.random() * canvas.width;
        }

        ctx.save();
        ctx.globalAlpha = p.opacity * fadeMultiplier;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.font = `${Math.round(p.size)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50 no-print"
      aria-hidden="true"
    />
  );
};
