import { useEffect, useState } from "react";

const AudioUnlocker = () => {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (unlocked) return;

    const unlock = () => {
      // Create and play a tiny silent sound to unlock audio on mobile
      const audio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA== ");
      audio.play()
        .then(() => {
          console.log("[AudioUnlocker] Audio context unlocked");
          setUnlocked(true);
          window.removeEventListener("touchstart", unlock);
          window.removeEventListener("click", unlock);
        })
        .catch(() => {
          // Still locked
        });
    };

    window.addEventListener("touchstart", unlock);
    window.addEventListener("click", unlock);

    return () => {
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("click", unlock);
    };
  }, [unlocked]);

  return null;
};

export default AudioUnlocker;
