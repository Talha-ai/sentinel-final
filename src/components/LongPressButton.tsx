import { useState, useRef } from 'react';

// Component for long-press button
const LongPressButton = ({
  onLongPress,
  text,
  className,
  longPressTime = 1500,
}: {
  onLongPress: () => void;
  text: string;
  className?: string;
  longPressTime?: number;
}) => {
  const [pressing, setPressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const startPress = () => {
    setPressing(true);
    setProgress(0);
    startTimeRef.current = Date.now();

    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const newProgress = Math.min((elapsed / longPressTime) * 100, 100);
      setProgress(newProgress);

      if (newProgress >= 100) {
        clearInterval(timerRef.current as number);
        onLongPress();
        setPressing(false);
        setProgress(0);
      }
    }, 50);
  };

  const endPress = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
    setProgress(0);
  };

  return (
    <button
      className={`relative overflow-hidden ${className}`}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      type="button"
    >
      <div className="z-10 relative">{text}</div>
      {pressing && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-gray-300 opacity-70 transition-all"
          style={{ width: `${progress}%` }}
        />
      )}
    </button>
  );
};

export default LongPressButton;
