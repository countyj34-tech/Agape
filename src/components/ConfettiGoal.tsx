import { useEffect } from 'react';
import confetti from 'canvas-confetti';

interface ConfettiGoalProps {
  goalAmount: number;
  currentTotal: number;
}

export function ConfettiGoal({ goalAmount, currentTotal }: ConfettiGoalProps) {
  useEffect(() => {
    if (currentTotal >= goalAmount && goalAmount > 0) {
      const duration = 2 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 25, spread: 360, ticks: 60, zIndex: 9999 };

      const interval: number = window.setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return window.clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti({
          ...defaults,
          particleCount,
          origin: { x: Math.random(), y: Math.random() - 0.2 },
        });
      }, 250);

      return () => {
        window.clearInterval(interval);
      };
    }
  }, [currentTotal, goalAmount]);

  return null;
}
