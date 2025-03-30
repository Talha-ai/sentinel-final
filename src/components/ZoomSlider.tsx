import React, { useState } from 'react';

interface ZoomSliderProps {
  savedZoomLevel: number;
  onZoomChange: (zoom: number) => void;
}

const ZoomSlider: React.FC<ZoomSliderProps> = ({
  savedZoomLevel,
  onZoomChange,
}) => {
  const [localZoom, setLocalZoom] = useState(savedZoomLevel);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Convert string to number and round to 1 decimal place
    const newZoom = Math.round(Number(e.target.value) * 10) / 10;
    setLocalZoom(newZoom);
    onZoomChange(newZoom);
  };

  const percentage = ((localZoom - 2) / 4) * 100;

  return (
    <div className="bg-[#EDEEFE] flex justify-center items-center relative bottom-3 pt-6 rounded-b-2xl p-4 mx-auto w-full max-w-[24rem]">
      <div className="flex items-center justify-center">
        <span className="text-black text-sm">Zoom:</span>
        <span className="text-black text-sm ml-1 mr-3">
          {localZoom.toFixed(1)}x
        </span>
      </div>
      <div className="relative w-full">
        <input
          type="range"
          min="2"
          max="6"
          step="0.1"
          value={localZoom}
          onChange={handleSliderChange}
          className="w-full h-1 relative bottom-0.5 rounded-full appearance-none cursor-pointer
           [&::-webkit-slider-thumb]:appearance-none
           [&::-webkit-slider-thumb]:w-5
           [&::-webkit-slider-thumb]:h-5 
           [&::-webkit-slider-thumb]:bg-[#4553ED]
           [&::-webkit-slider-thumb]:rounded-full"
          style={{
            background: `linear-gradient(to right, #4553ED 0%, #4553ED ${percentage}%, #CCCFFA ${percentage}%, #CCCFFA 100%)`,
          }}
        />
      </div>
    </div>
  );
};

export default ZoomSlider;
