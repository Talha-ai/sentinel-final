interface ImageComparisonProps {
  originalImage: string;
  enhancedImage: string;
  paddedImage?: string;
}

const ImageComparison: React.FC<ImageComparisonProps> = ({
  originalImage,
  enhancedImage,
  paddedImage,
}) => {
  return (
    <div className="flex text-black flex-col md:flex-row gap-4 w-full">
      <div className="flex-1">
        <h3 className="text-lg font-semibold mb-2">Original Image</h3>
        {originalImage && (
          <img
            src={originalImage}
            alt="Original QR"
            className="w-full border rounded-lg"
          />
        )}
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold mb-2">Padded Image</h3>
        {paddedImage && (
          <img
            src={paddedImage}
            alt="Padded QR"
            className="w-full border rounded-lg"
          />
        )}
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold mb-2">Enhanced Image</h3>
        {enhancedImage && (
          <img
            src={enhancedImage}
            alt="Enhanced QR"
            className="w-full border rounded-lg"
          />
        )}
      </div>
    </div>
  );
};

export default ImageComparison;
