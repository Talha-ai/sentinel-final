/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useState, useEffect } from 'react';
import { Upload, Loader } from 'lucide-react';
import ImageComparison from './components/ImageComparison';
import QrScanner from 'qr-scanner';
import { DecodeHintType, ResultMetadataType } from '@zxing/library';
import { BrowserQRCodeReader } from '@zxing/browser';
import LongPressButton from './components/LongPressButton';
import ZoomSlider from './components/ZoomSlider';

declare global {
  interface Window {
    cv: any;
  }
}

interface ScanHistoryEntry {
  timestamp: number;
  jsQRStatus: {
    passed: boolean;
    message: string;
  };
  sizeStatus?: {
    valid: boolean;
    width: number;
    height: number;
  };
  blurStatus?: {
    current: number;
    target: number;
    passed: boolean;
    adaptive: boolean;
  };
}

interface QRScannerResult {
  cornerPoints: { x: number; y: number }[];
  data: string;
}

interface CameraDimensions {
  width: number;
  height: number;
}

interface AnalysisResults {
  ssim_score?: number;
  phash_score?: number;
  ensemble_score?: number;
  mse_score?: number;
  fft_correlation_score?: number;
  white_pixel_loss?: number;
  reference_id?: string;
}

interface ScanningSettings {
  FRAME_PROCESSING_INTERVAL: number;
  BLUR_THRESHOLD: number;
  TARGET_QR_SIZE: number;
  INITIAL_ZOOM_LEVEL: number;
  MAX_ZOOM: number;
  BLUR_HISTORY_SIZE: number;
  MIN_BLUR_THRESHOLD: number;
}

const SETTINGS: ScanningSettings = {
  FRAME_PROCESSING_INTERVAL: 50,
  BLUR_THRESHOLD: 999,
  MIN_BLUR_THRESHOLD: 7,
  TARGET_QR_SIZE: 700,
  INITIAL_ZOOM_LEVEL: 3,
  MAX_ZOOM: 8,
  BLUR_HISTORY_SIZE: 10,
};

const zoomLevels = Array.from({ length: SETTINGS.MAX_ZOOM }, (_, i) => i + 1);

const QRScanner = () => {
  const [qrData, setQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dimen, setDimen] = useState<CameraDimensions | string | null>(null);
  const [showHiddenFeatures, setShowHiddenFeatures] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const [zoomLevel, setZoomLevel] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedSettings = localStorage.getItem('scanningSettings');

      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        return parsedSettings.INITIAL_ZOOM_LEVEL || SETTINGS.INITIAL_ZOOM_LEVEL;
      }
    }
    return SETTINGS.INITIAL_ZOOM_LEVEL;
  });

  const [savedZoomLevel, setSavedZoomLevel] = useState(zoomLevel);

  const [printType, setPrintType] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('printType') || 'None';
    }
    return 'None';
  });

  const [isOpenCVReady, setIsOpenCVReady] = useState(false);
  const [analysisResults, setAnalysisResults] =
    useState<AnalysisResults | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openCVLoadedRef = useRef(false);
  const processingRef = useRef(false);
  const engineRef = useRef<Promise<Worker | any> | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const shouldContinueProcessing = useRef(true);
  const canvasContext = useRef<CanvasRenderingContext2D | null>(null);
  const lastProcessedTime = useRef<number>(0);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayContextRef = useRef<CanvasRenderingContext2D | null>(null);
  // Add these variables to your component state/refs
  const blurValuesHistory = useRef<number[]>([]);
  const originalBlurThreshold = useRef<number>(SETTINGS.BLUR_THRESHOLD);
  const adaptiveThresholdApplied = useRef<boolean>(false);
  const consecutiveNoQRDetections = useRef<number>(0);
  // const consecutiveBlurFailures = useRef<number>(0);

  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [enhancedImage, setEnhancedImage] = useState<string | null>(null);
  const [paddedImage, setPaddedImage] = useState<string | null>(null);
  const [postScanStatus, setPostScanStatus] = useState({
    stage: '',
    progress: 0,
    isProcessing: false,
  });
  const [showEncodedStringInput, setShowEncodedStringInput] = useState(false);
  const [encodedString, setEncodedString] = useState('');

  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [showScanAgain, setShowScanAgain] = useState(false);
  const [noCamera, setNoCamera] = useState(false);

  //----setting up----

  //opencv
  const openCVInit = () => {
    if (openCVLoadedRef.current) return;
    openCVLoadedRef.current = true;

    if (window.cv && window.cv.onRuntimeInitialized) {
      setIsOpenCVReady(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    script.onload = () => {
      if (window.cv) {
        window.cv.onRuntimeInitialized = () => {
          setIsOpenCVReady(true);
        };
      }
    };

    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  };

  //qr-scanner engine
  useEffect(() => {
    engineRef.current = QrScanner.createQrEngine(QrScanner.WORKER_PATH);
    return () => {
      engineRef.current?.then((worker) => worker.terminate());
    };
  }, []);

  useEffect(() => {
    if (showScanner) {
      // Initialize everything else when scanner is shown
      openCVInit();
      setupCamera();

      // Initialize canvas contexts
      if (canvasRef.current) {
        canvasContext.current = canvasRef.current.getContext('2d');
      }

      if (overlayCanvasRef.current) {
        overlayContextRef.current = overlayCanvasRef.current.getContext('2d');
      }
    } else {
      // Clean up resources when scanner is hidden
      cleanup();
    }
  }, [showScanner]);

  //capture frame
  useEffect(() => {
    if (!showScanner) return;

    const video = videoRef.current;
    if (!video) return;

    const handleVideoReady = () => {
      // Only check if we have enough data
      if (video.readyState >= video.HAVE_ENOUGH_DATA) {
        console.log('Video ready, starting frame processing');
        shouldContinueProcessing.current = true;
        processFrame();
      } else {
        console.log('Video not ready yet, readyState:', video.readyState);
      }
    };

    // Add more events to catch different states
    video.addEventListener('loadedmetadata', handleVideoReady);
    video.addEventListener('loadeddata', handleVideoReady);
    video.addEventListener('play', handleVideoReady);
    video.addEventListener('canplay', handleVideoReady);

    // Check initial state in case events already fired
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
      console.log('Video already ready on mount');
      shouldContinueProcessing.current = true;
      processFrame();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleVideoReady);
      video.removeEventListener('loadeddata', handleVideoReady);
      video.removeEventListener('play', handleVideoReady);
      video.removeEventListener('canplay', handleVideoReady);
      cleanup();
    };
  }, [showScanner]);

  //canvas
  useEffect(() => {
    if (canvasRef.current) {
      canvasContext.current = canvasRef.current.getContext('2d');
    }
  }, []);

  // Initialize the overlay context in useEffect
  useEffect(() => {
    if (overlayCanvasRef.current) {
      overlayContextRef.current = overlayCanvasRef.current.getContext('2d');
    }
  }, []);

  //cleanup
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const setupCamera = async () => {
    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1400 },
          height: { ideal: 1400 },
          frameRate: { ideal: 30, max: 60 },
          // Add orientation constraint
          deviceOrientation: 'landscape',
          // Optional: specify exact orientation
          orientation: { exact: 'landscape-primary' },
        },
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(
        constraints
      );

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;

        // Set dimensions once we have camera access
        // Get video track and apply saved zoom level
        const track = mediaStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        console.log(capabilities);

        if ('zoom' in capabilities) {
          await track.applyConstraints({
            advanced: [{ zoom: savedZoomLevel } as any],
          });
          setZoomLevel(savedZoomLevel);
        }

        const settings = track.getSettings();
        setDimen({
          width: settings.width ?? 0,
          height: settings.height ?? 0,
        });
      }
    } catch (error) {
      console.error('Failed to access camera:', error);
      setNoCamera(true);
    }
  };

  const stopCamera = async () => {
    await cleanup();
    setShowScanAgain(true);
  };

  const startNewScan = async () => {
    setShowScanAgain(false);
    resetState();
    await setupCamera();
  };

  const cleanup = async () => {
    // Set processing flags first
    shouldContinueProcessing.current = false;
    processingRef.current = false;

    // Cancel animation frame
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    // Stop camera stream
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }

    if (overlayCanvasRef.current && overlayContextRef.current) {
      overlayContextRef.current.clearRect(
        0,
        0,
        overlayCanvasRef.current.width,
        overlayCanvasRef.current.height
      );
    }

    // Clear canvas
    if (canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      context?.clearRect(
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );
    }

    // Cleanup QR engine
    if (engineRef.current) {
      try {
        const engine = await engineRef.current;
        engine.terminate();
        engineRef.current = null;
      } catch (error) {
        console.error('Error terminating QR engine:', error);
      }
    }
  };

  const resetState = () => {
    shouldContinueProcessing.current = true; // Reset the processing flag
    SETTINGS.BLUR_THRESHOLD = originalBlurThreshold.current;
    blurValuesHistory.current = [];
    adaptiveThresholdApplied.current = false;
    consecutiveNoQRDetections.current = 0;
    countRef.current = 0;
    setQrData(null);
    setOriginalImage(null);
    setEnhancedImage(null);
    setPaddedImage(null);
    setError(null);
    setDimen(null);
    setAnalysisResults(null);
    successStatsRef.current = {
      versions: {},
      hints: {},
      rotations: {},
      combinations: {},
    };
  };

  //--- logic

  const [processingInterval, setProcessingInterval] = useState<number>(
    SETTINGS.FRAME_PROCESSING_INTERVAL
  );
  const [blurHistorySize, setBlurHistorySize] = useState<number>(
    SETTINGS.BLUR_HISTORY_SIZE
  );

  useEffect(() => {
    const savedSettings = localStorage.getItem('scanningSettings');
    if (savedSettings) {
      const parsedSettings = JSON.parse(savedSettings);
      Object.assign(SETTINGS, parsedSettings);

      setZoomLevel(
        parsedSettings.INITIAL_ZOOM_LEVEL || SETTINGS.INITIAL_ZOOM_LEVEL
      );

      setProcessingInterval(
        parsedSettings.FRAME_PROCESSING_INTERVAL ||
          SETTINGS.FRAME_PROCESSING_INTERVAL
      );
      setBlurHistorySize(
        parsedSettings.BLUR_HISTORY_SIZE || SETTINGS.BLUR_HISTORY_SIZE
      );
    }
  }, []);

  // Add this function to calculate if blur values are stable
  const areBlurValuesStable = (values: number[]): boolean => {
    if (values.length < blurHistorySize) return false;

    // Take the last n values (n = blurHistorySize)
    const lastValues = values.slice(-blurHistorySize);

    const min = Math.min(...lastValues);
    const max = Math.max(...lastValues);
    const range = max - min;

    // If the max blur value is above 100, skip the range check
    if (max > 100) return true;

    // Otherwise, check if the range is within 30
    return range <= 30;
  };

  const countRef = useRef(0);
  const calculateAdaptiveBlur = (values: number[]): number => {
    countRef.current += 1;
    const lastValues = values.slice(-blurHistorySize);

    const minBlur = Math.min(...lastValues);
    const maxBlur = Math.max(...lastValues);

    const range = maxBlur - minBlur;
    const reduction = Math.round(range * 0.2); // 20% of the range

    return maxBlur - reduction; // Reduce the max value by 20% of the range
  };

  // Function to reset adaptive threshold
  const resetAdaptiveThreshold = () => {
    adaptiveThresholdApplied.current = false;
    SETTINGS.BLUR_THRESHOLD = originalBlurThreshold.current;
    blurValuesHistory.current = [];
    consecutiveNoQRDetections.current = 0;
  };

  // Save settings to localStorage whenever they change
  const saveSettings = (key: string, value: number) => {
    const currentSettings = localStorage.getItem('scanningSettings')
      ? JSON.parse(localStorage.getItem('scanningSettings') || '{}')
      : { ...SETTINGS };

    currentSettings[key] = value;
    localStorage.setItem('scanningSettings', JSON.stringify(currentSettings));

    // Update the SETTINGS object
    SETTINGS[key as keyof ScanningSettings] = value;
  };

  const handleProcessingIntervalChange = (value: number) => {
    setProcessingInterval(value);
    saveSettings('FRAME_PROCESSING_INTERVAL', value);
  };

  const handleBlurHistorySizeChange = (value: number) => {
    setBlurHistorySize(value);
    saveSettings('BLUR_HISTORY_SIZE', value);
  };

  const processingIntervalOptions = [
    10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 1000,
  ];
  const blurHistorySizeOptions = [3, 5, 7, 10, 15, 20];

  const processFrame = async () => {
    if (
      !shouldContinueProcessing.current ||
      processingRef.current ||
      !videoRef.current ||
      !canvasRef.current
    ) {
      return;
    }

    const currentTime = Date.now();
    if (
      currentTime - lastProcessedTime.current <
      SETTINGS.FRAME_PROCESSING_INTERVAL
    ) {
      requestAnimationFrame(processFrame);
      return;
    }

    processingRef.current = true;
    lastProcessedTime.current = currentTime;

    if (!canvasContext.current) {
      processingRef.current = false;
      requestAnimationFrame(processFrame);
      return;
    }

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvasContext.current.drawImage(video, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.95);
      });

      if (!blob || !shouldContinueProcessing.current) {
        return;
      }

      const result = await QrScanner.scanImage(blob, {
        qrEngine: await engineRef.current,
        returnDetailedScanResult: true,
        scanRegion: {
          x: 0,
          y: 0,
          width: video.videoWidth,
          height: video.videoHeight,
          downScaledWidth: 800,
          downScaledHeight: (video.videoHeight / video.videoWidth) * 800,
        },
      });

      if (overlayCanvasRef.current && overlayContextRef.current) {
        const overlay = overlayCanvasRef.current;
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        overlayContextRef.current.clearRect(
          0,
          0,
          overlay.width,
          overlay.height
        );
      }

      if (
        (result.data === '' && result.cornerPoints?.length === 4) ||
        !result?.data
      ) {
        setError('QR code broken!');
        addScanHistoryEntry({
          timestamp: Date.now(),
          jsQRStatus: { passed: false, message: 'QR code broken' },
        });
      } else {
        setError('');

        // More efficient corner points handling
        if (overlayContextRef.current && result.cornerPoints?.length === 4) {
          const ctx = overlayContextRef.current;
          const points = result.cornerPoints;

          // Set styling for the box - combine properties
          ctx.lineWidth = 8;
          ctx.strokeStyle = '#4553ED';
          ctx.fillStyle = '#4553ED';
          ctx.font = '24px Arial';

          // Draw border more efficiently
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(points[i].x, points[i].y);
          ctx.closePath(); // More efficient than extra lineTo
          ctx.stroke();
        }

        const imageData = canvasContext.current.getImageData(
          0,
          0,
          video.videoWidth,
          video.videoHeight
        );

        // First check size
        const sizeStatus = checkQRSizeFromCornerPoints(result.cornerPoints);

        // Create entry for scan history
        const scanEntry: ScanHistoryEntry = {
          timestamp: Date.now(),
          jsQRStatus: { passed: true, message: 'QR Code detected' },
          sizeStatus: sizeStatus,
        };

        // Add guide message for size check failure
        if (!sizeStatus.valid && overlayContextRef.current) {
          drawGuideMessage(
            overlayContextRef.current,
            'Zoom to fit the QR in guide',
            video.videoWidth,
            video.videoHeight,
            '#F7DC3E'
          );
        }

        if (sizeStatus.valid && overlayContextRef.current) {
          const blurValue = (await measureBlurOpenCV(imageData)) as number;
          blurValuesHistory.current.push(blurValue);

          // Check if blur values are stable and we should adapt threshold
          if (
            !adaptiveThresholdApplied.current &&
            areBlurValuesStable(blurValuesHistory.current)
          ) {
            const avgBlur = calculateAdaptiveBlur(blurValuesHistory.current);

            if (avgBlur < SETTINGS.MIN_BLUR_THRESHOLD) {
              setError('Move to better lighting and try again');
              stopCamera();
              return;
            }

            console.log(
              `Adapting blur threshold to: ${avgBlur} based on stable readings`
            );
            SETTINGS.BLUR_THRESHOLD = avgBlur;
            adaptiveThresholdApplied.current = true;
            // consecutiveBlurFailures.current = 0;
          }

          const blurStatus = {
            passed: blurValue >= SETTINGS.BLUR_THRESHOLD,
            current: blurValue,
            target: SETTINGS.BLUR_THRESHOLD,
            adaptive: adaptiveThresholdApplied.current,
          };

          scanEntry.blurStatus = blurStatus;

          if (
            !blurStatus.passed &&
            sizeStatus.valid &&
            overlayContextRef.current
          ) {
            drawGuideMessage(
              overlayContextRef.current,
              'Keep in focus',
              video.videoWidth,
              video.videoHeight,
              '#1CE882'
            );
          } else {
            drawGuideMessage(
              overlayContextRef.current,
              'Keep in focus',
              video.videoWidth,
              video.videoHeight,
              '#1CE882'
            );
          }

          // If both size and blur checks pass, handle successful scan
          if (blurStatus.passed && adaptiveThresholdApplied.current) {
            const audio = new Audio('/scanning_beep.mp3');
            await audio
              .play()
              .catch((err) => console.error('Error playing audio:', err));

            shouldContinueProcessing.current = false;

            // Clear overlay if it exists
            if (overlayContextRef.current && overlayCanvasRef.current) {
              overlayContextRef.current.clearRect(
                0,
                0,
                overlayCanvasRef.current.width,
                overlayCanvasRef.current.height
              );
            }

            await handleSuccessfulScan(result, imageData);
          }
        }

        addScanHistoryEntry(scanEntry);
      }
    } catch (error) {
      if (overlayContextRef.current && overlayCanvasRef.current) {
        overlayContextRef.current.clearRect(
          0,
          0,
          overlayCanvasRef.current.width,
          overlayCanvasRef.current.height
        );
      }
      if (error !== 'No QR code found.' && shouldContinueProcessing.current) {
        console.error('QR scan error:', error);
      }

      // Increment consecutive QR detection failures
      consecutiveNoQRDetections.current++;

      // If we've had 5 consecutive failures, reset adaptive threshold
      if (consecutiveNoQRDetections.current >= blurHistorySize) {
        resetAdaptiveThreshold();
        consecutiveNoQRDetections.current = 0;
      }

      addScanHistoryEntry({
        timestamp: Date.now(),
        jsQRStatus: { passed: false, message: 'No QR code detected' },
      });
    } finally {
      processingRef.current = false;
      if (shouldContinueProcessing.current) {
        requestAnimationFrame(processFrame);
      }
    }
  };

  const handleSuccessfulScan = async (
    result: QrScanner.ScanResult,
    imageData: ImageData
  ) => {
    try {
      if (overlayContextRef.current && overlayCanvasRef.current) {
        overlayContextRef.current.clearRect(
          0,
          0,
          overlayCanvasRef.current.width,
          overlayCanvasRef.current.height
        );
      }

      stopCamera();

      const qrData = result.data;
      if (!isValidAlemeno(qrData)) {
        setError('Not a valid Sentinel QR');
      }

      console.log(qrData);
      setQrData(qrData);

      setPostScanStatus({
        stage: 'Processing image...',
        progress: 10,
        isProcessing: true,
      });

      // Create initial canvas from image data
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');

      canvas.width = imageData.width;
      canvas.height = imageData.height;
      ctx.putImageData(imageData, 0, 0);

      // Apply perspective correction
      setPostScanStatus({
        stage: 'Correcting image perspective...',
        progress: 30,
        isProcessing: true,
      });

      const correctedCanvas = applyPerspectiveCorrection(canvas, result);
      if (!correctedCanvas) throw new Error('Perspective correction failed');

      // Apply grayscale with OpenCV
      setPostScanStatus({
        stage: 'Converting to grayscale...',
        progress: 50,
        isProcessing: true,
      });

      let grayscaleCanvas;

      if (window.cv) {
        // Create a grayscale version using OpenCV
        const src = window.cv.imread(correctedCanvas);
        const gray = new window.cv.Mat();
        window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

        grayscaleCanvas = document.createElement('canvas');
        window.cv.imshow(grayscaleCanvas, gray);

        // Clean up OpenCV resources
        src.delete();
        gray.delete();
      } else {
        console.error('OpenCV not initialized, using original canvas.');
        grayscaleCanvas = correctedCanvas;
      }

      // Now verify orientation with the grayscale image
      setPostScanStatus({
        stage: 'Verifying QR orientation...',
        progress: 70,
        isProcessing: true,
      });

      const finalCorrectedCanvas = await verifyAndCorrectOrientation(
        grayscaleCanvas
      );
      if (!finalCorrectedCanvas) {
        // Clean up resources if verification fails
        if (grayscaleCanvas !== correctedCanvas) {
          grayscaleCanvas.remove();
        }
        correctedCanvas.remove();
        canvas.remove();
        return;
      }

      // Store both original and enhanced images
      setOriginalImage(correctedCanvas.toDataURL('image/png'));
      setEnhancedImage(finalCorrectedCanvas.toDataURL('image/png'));

      // Convert to Blob
      setPostScanStatus({
        stage: 'Converting image...',
        progress: 80,
        isProcessing: true,
      });

      const file = await canvasToFile(finalCorrectedCanvas, result.data);
      if (!file) throw new Error('Failed to create image blob');

      // Send to API
      setPostScanStatus({
        stage: 'Sending to server...',
        progress: 90,
        isProcessing: true,
      });

      await sendToAPI(file, result.data);

      // Cleanup
      if (grayscaleCanvas !== correctedCanvas) {
        grayscaleCanvas.remove();
      }
      if (finalCorrectedCanvas !== grayscaleCanvas) {
        finalCorrectedCanvas.remove();
      }
      correctedCanvas.remove();
      canvas.remove();

      setPostScanStatus({
        stage: 'Processing complete!',
        progress: 100,
        isProcessing: false,
      });

      stopCamera();
    } catch (err) {
      console.error('Error in handleSuccessfulScan:', err);

      setError('Failed to process image, try again');
      // setError(
      //   err instanceof Error ? `${err.message}` : 'Failed to process image'
      // );

      setShowScanAgain(true);
      setPostScanStatus({
        stage: 'Error processing image',
        progress: 0,
        isProcessing: false,
      });
    }
  };

  //----API call----

  const getBrowserInfo = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Chrome')) return 'chrome';
    if (ua.includes('Firefox')) return 'firefox';
    if (ua.includes('Safari')) return 'safari';
    if (ua.includes('Edge')) return 'edge';
    return 'browser';
  };

  const createFilename = (_qrData: any) => {
    const browser = getBrowserInfo();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${browser}-${timestamp}.png`;
  };

  const canvasToFile = async (
    canvas: HTMLCanvasElement,
    qrData: any
  ): Promise<File> => {
    return new Promise((resolve, reject) => {
      if (!canvas) {
        reject(new Error('Canvas element is missing'));
        return;
      }

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to blob'));
          return;
        }

        const filename = createFilename(qrData);
        const file = new File([blob], filename, { type: 'image/png' });
        resolve(file);
      }, 'image/png');
    });
  };

  function isValidAlemeno(url: string): boolean {
    const pattern = /https:\/\/qr\.alemeno\.com\/[A-Za-z0-9#@&*]{8}/;
    console.log(pattern.test(url));
    return pattern.test(url);
  }

  // Function to extract just the ID from a valid URL
  function extractAlememoId(url: string): string | null {
    // Regex with capturing group for the ID
    const pattern = /https:\/\/qr\.alemeno\.com\/([A-Za-z0-9#@&*]{8})/;

    // Execute the regex to get matches
    const match = pattern.exec(url);

    // Return the ID (first capturing group) if there's a match, otherwise null
    return match ? match[1] : null;
  }

  const sendToAPI = async (imageFile: string | Blob, qrData: string) => {
    try {
      if (!isValidAlemeno(qrData)) {
        throw new Error('Not a valid Sentinel QR');
      }

      const scanId = extractAlememoId(qrData);
      if (!scanId) {
        throw new Error('Failed to extract scan ID');
      }

      // const textInput = `${scanId}-8`; // Format as 'scanId-gridsize'
      // const currentPrintType = localStorage.getItem('printType') || 'None';

      const formData = new FormData();
      formData.append('input_image', imageFile);
      formData.append('fingerprint_id', scanId);

      const response = await fetch('https://scan.alemeno.com/noiseqr/noise/', {
        method: 'POST',
        body: formData,
      });

      if (response.status === 408) {
        throw new Error('Invalid QR');
      }

      if (!response.ok) {
        throw new Error(`Failed to analyze image`);
      }

      const data = await response.json();
      setAnalysisResults(data);
    } catch (error) {
      if (error instanceof Error) {
        setError(`${error.message}`);
      } else {
        setError('An unknown error occurred');
      }
      setPostScanStatus({
        stage: 'Error during analysis',
        progress: 0,
        isProcessing: false,
      });
    }
  };

  //----Pre-processing & misc----

  const measureBlurOpenCV = async (imageData: ImageData) => {
    return new Promise((resolve) => {
      if (!window.cv || !window.cv.Laplacian) {
        console.error('OpenCV.js is not loaded yet.');
        resolve(null);
        return;
      }

      // Convert ImageData to a Canvas
      let canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      let ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(imageData, 0, 0);
      }

      let src = window.cv.imread(canvas); // Read from Canvas instead of ImageData
      let gray = new window.cv.Mat();
      let laplacian = new window.cv.Mat();
      let mean = new window.cv.Mat();
      let stddev = new window.cv.Mat();

      // Convert to grayscale
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

      // Apply Gaussian blur to reduce noise
      window.cv.GaussianBlur(gray, gray, new window.cv.Size(3, 3), 0);

      // Apply Laplacian edge detection
      window.cv.Laplacian(gray, laplacian, window.cv.CV_64F);

      // Compute variance of edge intensities
      window.cv.meanStdDev(laplacian, mean, stddev);
      let blurScore = stddev.data64F[0] ** 2; // Variance of Laplacian

      // Cleanup memory
      src.delete();
      gray.delete();
      laplacian.delete();
      mean.delete();
      stddev.delete();

      resolve(blurScore);
    });
  };

  const applyPerspectiveCorrection = (
    sourceCanvas: HTMLCanvasElement,
    result: QRScannerResult
  ): HTMLCanvasElement | null => {
    try {
      if (!window.cv) {
        setError('OpenCV not available');
        return null;
      }

      if (!result?.cornerPoints || result.cornerPoints.length !== 4) {
        console.error('Invalid corner points:', result?.cornerPoints);
        return null;
      }

      const ctx = sourceCanvas.getContext('2d');
      if (!ctx) {
        setError('Failed to get canvas context');
        return null;
      }

      const points = [...result.cornerPoints];

      const topLeft = points[0]; // index 0 is top-left
      const topRight = points[1]; // index 1 is top-right
      const bottomRight = points[2]; // index 2 is bottom-right
      const bottomLeft = points[3]; // index 3 is bottom-left

      // Create source points array
      const srcPointsArray = new Float32Array([
        topLeft.x,
        topLeft.y, // points[0]
        topRight.x,
        topRight.y, // points[1]
        bottomRight.x,
        bottomRight.y, // points[2]
        bottomLeft.x,
        bottomLeft.y, // points[3]
      ]);

      // Calculate final width and height
      const width = Math.max(
        Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
        Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y)
      );

      const height = Math.max(
        Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
        Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y)
      );

      const finalSize = Math.ceil(Math.max(width, height));

      if (finalSize <= 0 || !Number.isFinite(finalSize) || finalSize > 4000) {
        setError(`Invalid final size: ${finalSize}`);
        return null;
      }

      // Destination points for corrected perspective
      const dstPointsArray = new Float32Array([
        0,
        0, // Top-left
        finalSize,
        0, // Top-right
        finalSize,
        finalSize, // Bottom-right
        0,
        finalSize, // Bottom-left
      ]);

      // OpenCV operations
      const srcPoints = window.cv.matFromArray(
        4,
        1,
        window.cv.CV_32FC2,
        srcPointsArray
      );
      const dstPoints = window.cv.matFromArray(
        4,
        1,
        window.cv.CV_32FC2,
        dstPointsArray
      );
      const perspectiveMatrix = window.cv.getPerspectiveTransform(
        srcPoints,
        dstPoints
      );

      const src = window.cv.imread(sourceCanvas);
      const dst = new window.cv.Mat();

      // Apply perspective warp
      window.cv.warpPerspective(
        src,
        dst,
        perspectiveMatrix,
        new window.cv.Size(finalSize, finalSize)
      );

      // Create output canvas
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = finalSize;
      outputCanvas.height = finalSize;
      window.cv.imshow(outputCanvas, dst);

      // Cleanup
      src.delete();
      dst.delete();
      srcPoints.delete();
      dstPoints.delete();
      perspectiveMatrix.delete();

      return outputCanvas;
    } catch (err) {
      console.error('Error in perspective correction:', err);
      return null;
    }
  };

  const checkQRSizeFromCornerPoints = (
    cornerPoints: Array<{ x: number; y: number }>
  ) => {
    const avgSide =
      (Math.hypot(
        cornerPoints[1].x - cornerPoints[0].x,
        cornerPoints[1].y - cornerPoints[0].y
      ) +
        Math.hypot(
          cornerPoints[2].x - cornerPoints[1].x,
          cornerPoints[2].y - cornerPoints[1].y
        ) +
        Math.hypot(
          cornerPoints[3].x - cornerPoints[2].x,
          cornerPoints[3].y - cornerPoints[2].y
        ) +
        Math.hypot(
          cornerPoints[0].x - cornerPoints[3].x,
          cornerPoints[0].y - cornerPoints[3].y
        )) /
      4;

    return {
      valid: avgSide >= SETTINGS.TARGET_QR_SIZE,
      width: avgSide,
      height: avgSide,
    };
  };

  //----Corecting orientation----

  // Define the type for successStats
  type SuccessStats = {
    versions: Record<string, number>;
    hints: Record<string, number>;
    rotations: Record<number, number>;
    combinations: Record<string, number>;
  };

  // Statistics counter for successful detections
  const successStatsRef = useRef<SuccessStats>({
    versions: {},
    hints: {},
    rotations: {},
    combinations: {},
  });

  const verifyAndCorrectOrientation = async (
    correctedCanvas: HTMLCanvasElement
  ): Promise<HTMLCanvasElement | null> => {
    try {
      console.log('Starting multi-step QR code detection...');

      const addQuietZone = (
        canvas: HTMLCanvasElement,
        padding = 60
      ): HTMLCanvasElement => {
        // Create a new canvas with added padding
        const paddedCanvas = document.createElement('canvas');
        const paddedCtx = paddedCanvas.getContext('2d');

        // Set the new canvas size with padding on all sides
        paddedCanvas.width = canvas.width + padding * 2;
        paddedCanvas.height = canvas.height + padding * 2;

        // Fill the entire canvas with white (for the quiet zone)
        if (paddedCtx) {
          paddedCtx.fillStyle = 'white';
          paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);

          // Draw the original canvas in the center of the padded canvas
          paddedCtx.drawImage(canvas, padding, padding);
        }
        setPaddedImage(paddedCanvas.toDataURL('image/png'));
        return paddedCanvas;
      };

      // Make sure OpenCV is loaded before using these functions
      function increaseContrast(canvas: HTMLCanvasElement): HTMLCanvasElement {
        // Convert canvas to cv.Mat
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const src = window.cv.matFromImageData(imageData);

        // Create output matrix
        const dst = new window.cv.Mat();

        // Apply contrast enhancement
        // Alpha > 1 increases contrast, beta shifts brightness
        const alpha = 1.5; // Contrast control
        const beta = 0; // Brightness control
        window.cv.convertScaleAbs(src, dst, alpha, beta);

        // Convert back to canvas
        window.cv.imshow(canvas, dst);

        // Clean up
        src.delete();
        dst.delete();

        return canvas;
      }

      function applyThresholding(canvas: HTMLCanvasElement): HTMLCanvasElement {
        // Convert canvas to cv.Mat
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const src = window.cv.matFromImageData(imageData);

        // Create output matrix and temporary grayscale matrix
        const dst = new window.cv.Mat();
        const gray = new window.cv.Mat();

        // Convert to grayscale
        window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

        // Apply thresholding
        // 128 is the threshold value, 255 is the maximum value
        window.cv.threshold(gray, dst, 128, 255, window.cv.THRESH_BINARY);

        // Convert back to canvas
        window.cv.imshow(canvas, dst);

        // Clean up
        src.delete();
        dst.delete();
        gray.delete();

        return canvas;
      }

      const cloneCanvas = (
        sourceCanvas: HTMLCanvasElement
      ): HTMLCanvasElement => {
        const newCanvas = document.createElement('canvas');
        const ctx = newCanvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context for cloned canvas');
        newCanvas.width = sourceCanvas.width;
        newCanvas.height = sourceCanvas.height;
        ctx.drawImage(sourceCanvas, 0, 0);
        return newCanvas;
      };

      // Create multiple versions of the image with different preprocessing
      const versions = [
        {
          name: 'binarized',
          canvas: addQuietZone(
            applyThresholding(cloneCanvas(correctedCanvas)),
            120
          ),
        },
        {
          name: 'high-contrast',
          canvas: addQuietZone(
            increaseContrast(cloneCanvas(correctedCanvas)),
            120
          ),
        },
        { name: 'padded', canvas: addQuietZone(correctedCanvas, 120) },
      ];

      // Try different hint configurations with descriptive names
      const hintConfigurations = [
        {
          name: 'TRY_HARDER',
          getHints: () => {
            const hints = new Map();
            hints.set(DecodeHintType.TRY_HARDER, true);
            return hints;
          },
        },
      ];

      // Try each version with different rotation angles and hint configurations
      for (const { name: versionName, canvas } of versions) {
        console.log(`Trying ${versionName} version...`);

        for (const { name: hintName, getHints } of hintConfigurations) {
          console.log(`Using hint configuration: ${hintName}`);
          const hints = getHints();
          const reader = new BrowserQRCodeReader(hints);

          for (const angle of [0, 90, 180, 270]) {
            try {
              const rotated =
                angle === 0 ? canvas : rotateCanvas(canvas, angle);
              console.log(
                `Attempting ${versionName} with ${hintName} at ${angle}° rotation...`
              );

              const result = reader.decodeFromCanvas(rotated);

              if (result) {
                // Record successful detection stats
                successStatsRef.current.versions[versionName] =
                  (successStatsRef.current.versions[versionName] || 0) + 1;
                successStatsRef.current.hints[hintName] =
                  (successStatsRef.current.hints[hintName] || 0) + 1;
                successStatsRef.current.rotations[angle] =
                  (successStatsRef.current.rotations[angle] || 0) + 1;

                const combinationKey = `${versionName}+${hintName}+${angle}`;
                successStatsRef.current.combinations[combinationKey] =
                  (successStatsRef.current.combinations[combinationKey] || 0) +
                  1;

                const errorCorrectionLevel = result
                  .getResultMetadata()
                  .get(ResultMetadataType.ERROR_CORRECTION_LEVEL);

                console.log('Error Correction Level:', errorCorrectionLevel);

                // If we have finder patterns, use them to determine the correct orientation
                if (result.getResultPoints()?.length >= 3) {
                  const finderPatterns = result.getResultPoints().slice(0, 3);

                  // Convert finder patterns to simple x,y objects
                  const patternPoints = finderPatterns.map((point) => ({
                    x: point.getX(),
                    y: point.getY(),
                  }));

                  // Determine orientation using finder patterns
                  const orientation = determineQROrientation(
                    patternPoints[0],
                    patternPoints[1],
                    patternPoints[2]
                  );

                  // Determine if additional rotation is needed based on finder pattern positions
                  const additionalRotation =
                    determineRotationAngle(orientation);

                  // Calculate total rotation needed (initial rotation + additional)
                  const totalRotation = (angle + additionalRotation) % 360;

                  // If total rotation is needed, apply it to the original canvas
                  if (totalRotation !== 0) {
                    console.log(
                      `Rotating original canvas by ${totalRotation}°`
                    );
                    return rotateCanvas(correctedCanvas, totalRotation);
                  }

                  // If no rotation is needed, return the original
                  return correctedCanvas;
                }

                // If we don't have finder patterns but decoded successfully,
                // just apply the rotation that worked
                if (angle !== 0) {
                  console.log(
                    `Applying successful rotation of ${angle}° to original canvas`
                  );
                  return rotateCanvas(correctedCanvas, angle);
                }

                return correctedCanvas;
              }
            } catch (e) {
              console.log(
                `Failed with ${versionName} + ${hintName} at ${angle}° rotation: ${e}`
              );
            }
          }
        }
      }

      // If we've tried everything and still failed
      console.error('All detection attempts failed');
      throw new Error('QR code detection failed after multiple attempts');
    } catch (err) {
      console.error('Error in verification process:', err);
      setError(`Orientation correction failed, try again`);

      stopCamera();
      setPostScanStatus({
        stage: 'Error processing image',
        progress: 0,
        isProcessing: false,
      });
      return null;
    }
  };

  // Helper function to determine QR code orientation based on finder patterns
  const determineQROrientation = (
    finder1: { x: number; y: number },
    finder2: { x: number; y: number },
    finder3: { x: number; y: number }
  ) => {
    // Calculate distances between finder patterns
    const dist12 = Math.hypot(finder2.x - finder1.x, finder2.y - finder1.y);
    const dist23 = Math.hypot(finder3.x - finder2.x, finder3.y - finder2.y);
    const dist31 = Math.hypot(finder1.x - finder3.x, finder1.y - finder3.y);

    // Find the longest side - this will be between top-right and bottom-left
    const maxDist = Math.max(dist12, dist23, dist31);

    let topLeft, topRight, bottomLeft;

    if (maxDist === dist12) {
      // finder3 is top-left
      topLeft = finder3;
      // Determine which of finder1 or finder2 is top-right vs bottom-left
      if (finder1.y < finder2.y) {
        topRight = finder1;
        bottomLeft = finder2;
      } else {
        topRight = finder2;
        bottomLeft = finder1;
      }
    } else if (maxDist === dist23) {
      // finder1 is top-left
      topLeft = finder1;
      if (finder2.y < finder3.y) {
        topRight = finder2;
        bottomLeft = finder3;
      } else {
        topRight = finder3;
        bottomLeft = finder2;
      }
    } else {
      // finder2 is top-left
      topLeft = finder2;
      if (finder3.y < finder1.y) {
        topRight = finder3;
        bottomLeft = finder1;
      } else {
        topRight = finder1;
        bottomLeft = finder3;
      }
    }

    // Calculate bottom-right point based on other three corners
    // const bottomRight = {
    //   x: topRight.x + (bottomLeft.x - topLeft.x),
    //   y: bottomLeft.y + (topRight.y - topLeft.y),
    // };
    // console.log(topLeft, topRight, bottomRight, bottomLeft);
    return {
      topLeft,
      topRight,
      // bottomRight,
      bottomLeft,
    };
  };
  // Function to determine required rotation angle based on finder pattern orientation
  const determineRotationAngle = (orientation: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    // bottomRight: { x: number; y: number };
  }): number => {
    const { topLeft, topRight, bottomLeft } = orientation;

    // Calculate the center of the QR code
    const centerX = (topLeft.x + topRight.x + bottomLeft.x) / 3;
    const centerY = (topLeft.y + topRight.y + bottomLeft.y) / 3;

    console.log('Center of QR Code:', { centerX, centerY });
    console.log('Corners:', { topLeft, topRight, bottomLeft });

    // Determine topLeft's position relative to the center
    const topLeftQuadrant = {
      x: topLeft.x < centerX ? 'left' : 'right',
      y: topLeft.y < centerY ? 'top' : 'bottom',
    };

    console.log('Top-left quadrant:', topLeftQuadrant);

    // Decide rotation based on topLeft's position
    if (topLeftQuadrant.x === 'right' && topLeftQuadrant.y === 'top') {
      console.log('Rotating 90° clockwise');
      return 90;
    } else if (
      topLeftQuadrant.x === 'right' &&
      topLeftQuadrant.y === 'bottom'
    ) {
      console.log('Rotating 180°');
      return 180;
    } else if (topLeftQuadrant.x === 'left' && topLeftQuadrant.y === 'bottom') {
      console.log('Rotating 270° clockwise (90° counterclockwise)');
      return 270;
    }

    console.log('No rotation needed');
    return 0;
  };

  const rotateCanvas = (
    canvas: HTMLCanvasElement,
    angle: number
  ): HTMLCanvasElement => {
    const rotatedCanvas = document.createElement('canvas');
    const ctx = rotatedCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // For 90° and 270° rotations, swap width and height
    if (angle === 90 || angle === 270) {
      rotatedCanvas.width = canvas.height;
      rotatedCanvas.height = canvas.width;
    } else {
      rotatedCanvas.width = canvas.width;
      rotatedCanvas.height = canvas.height;
    }

    ctx.save();

    // Move to the center of the destination canvas
    ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);

    // Invert rotation angle as needed
    const rotationAngle = angle === 90 ? -90 : angle === 270 ? 90 : angle;
    ctx.rotate((rotationAngle * Math.PI) / 180);

    // IMPORTANT: Need to handle drawing coordinates correctly
    if (angle === 90 || angle === 270) {
      // For rotations that swap dimensions, we need to be careful with the
      // source and destination rectangles to maintain aspect ratio
      ctx.drawImage(
        canvas,
        -canvas.height / 2, // x position is now based on height because dimensions are swapped
        -canvas.width / 2, // y position is now based on width because dimensions are swapped
        canvas.height, // draw width is now the original height
        canvas.width // draw height is now the original width
      );
    } else {
      // For 0 and 180 degrees, dimensions stay the same
      ctx.drawImage(
        canvas,
        -canvas.width / 2,
        -canvas.height / 2,
        canvas.width,
        canvas.height
      );
    }

    ctx.restore();

    return rotatedCanvas;
  };

  //------------------

  const drawGuideMessage = (
    ctx: CanvasRenderingContext2D,
    message: string,
    width: number,
    height: number,
    bg: string
  ) => {
    // Set font for measurement
    ctx.font = 'bold 60px Arial, sans-serif';

    // Measure the text width
    const textWidth = ctx.measureText(message).width;

    // Calculate button width based on text (with padding)
    const padding = 80; // 40px on each side
    const buttonWidth = Math.min(
      Math.max(textWidth + padding, 200),
      width - 40
    ); // Min 200px, max is screen width - 40px
    const buttonHeight = 100;
    const buttonX = (width - buttonWidth) / 2;
    const buttonY = height - buttonHeight - 100; // Position at bottom with some margin

    // Draw yellow pill-shaped button with enhanced smoothness
    ctx.save();

    // Enable anti-aliasing for smoother rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Add shadow for depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    // Button background with higher corner radius for smoother appearance
    ctx.fillStyle = bg;
    ctx.beginPath();
    const cornerRadius = 30; // Increased corner radius for smoother pill shape
    ctx.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, cornerRadius);
    ctx.fill();

    // Remove shadow for text
    ctx.shadowColor = 'transparent';

    // Button text with improved font
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 60px Arial, sans-serif'; // Bold text looks better at larger sizes
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      message,
      buttonX + buttonWidth / 2,
      buttonY + buttonHeight / 2
    );

    ctx.restore();
  };

  const ResultsDisplay = ({ results }: { results: AnalysisResults | null }) => {
    if (!results) return null;

    return (
      <div className="mt-4 bg-white text-black rounded-lg p-4 shadow-md">
        <h3 className="text-lg font-semibold mb-3">Analysis Results</h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">SSIM Score:</span>
            <span className="font-medium">
              {results.ssim_score?.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">pHash Score:</span>
            <span className="font-medium">
              {results.phash_score?.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Ensemble Score:</span>
            <span className="font-medium">
              {results.ensemble_score?.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">MSE Score:</span>
            <span className="font-medium">{results.mse_score?.toFixed(4)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">FFT correlation Score:</span>
            <span className="font-medium">
              {results.fft_correlation_score?.toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">White pixel loss Score:</span>
            <span className="font-medium">
              {results.white_pixel_loss?.toFixed(4)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const handlePrintTypeChange = (value: any) => {
    setPrintType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('printType', value);
    }
  };

  const handleZoomChange = async (newZoom: number) => {
    setSavedZoomLevel(newZoom);
    setZoomLevel(newZoom);

    saveSettings('INITIAL_ZOOM_LEVEL', newZoom);

    blurValuesHistory.current = [];
    adaptiveThresholdApplied.current = false;
    consecutiveNoQRDetections.current = 0;
    SETTINGS.BLUR_THRESHOLD = originalBlurThreshold.current;

    if (videoRef.current?.srcObject instanceof MediaStream) {
      const videoTrack = videoRef.current.srcObject.getVideoTracks()[0];
      if (videoTrack) {
        try {
          await videoTrack.applyConstraints({
            advanced: [{ zoom: newZoom } as any],
          });
        } catch (error) {
          console.error('Failed to apply zoom:', error);
        }
      }
    }
  };

  const addScanHistoryEntry = (entry: ScanHistoryEntry) => {
    setScanHistory((prev) => [entry, ...prev].slice(0, 15));
  };

  //----Upload QR----

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    try {
      const file = event.target.files?.[0];
      if (!file) {
        setError('No file selected');
        return;
      }

      setPostScanStatus({
        stage: 'Starting image processing...',
        progress: 10,
        isProcessing: true,
      });

      resetState();
      stopCamera();

      // Create a promise wrapper for image loading
      const loadImage = (url: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = document.createElement('img');
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      };

      // Read file and convert to image
      const imageUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const img = await loadImage(imageUrl);

      const MAX_DIMENSION = 2000;
      const scale = Math.min(
        1,
        MAX_DIMENSION / Math.max(img.width, img.height)
      );
      const width = Math.floor(img.width * scale);
      const height = Math.floor(img.height * scale);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      setPostScanStatus({
        stage: 'Detecting QR code...',
        progress: 30,
        isProcessing: true,
      });

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/png');
      });

      const result = await QrScanner.scanImage(blob, {
        qrEngine: await engineRef.current,
        returnDetailedScanResult: true,
        scanRegion: {
          x: 0,
          y: 0,
          width: width,
          height: height,
          downScaledWidth: 800,
          downScaledHeight: (height / width) * 800,
        },
      });

      if (!result) {
        throw new Error(
          'No QR code found in the image. Try adjusting the image lighting or angle.'
        );
      }

      setQrData(result.data);

      setPostScanStatus({
        stage: 'Correcting image perspective...',
        progress: 50,
        isProcessing: true,
      });

      const correctedCanvas = applyPerspectiveCorrection(canvas, result);
      if (!correctedCanvas) {
        throw new Error('Perspective correction failed');
      }

      // OpenCV Processing
      if (window.cv) {
        setPostScanStatus((prev) => ({
          ...prev,
          stage: 'Applying OpenCV processing...',
          progress: 60,
        }));

        const src = window.cv.imread(correctedCanvas);
        const gray = new window.cv.Mat();
        window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

        window.cv.imshow(canvas, gray); // Reuse canvas

        src.delete();
        gray.delete();
      } else {
        console.warn('OpenCV not initialized, skipping OpenCV processing.');
      }

      setPostScanStatus((prev) => ({
        ...prev,
        stage: 'Verifying QR orientation...',
        progress: 40,
      }));

      const orientationCorrectedCanvas = await verifyAndCorrectOrientation(
        canvas
      );

      if (!orientationCorrectedCanvas) {
        return;
      }

      setPostScanStatus({
        stage: 'Processing image...',
        progress: 70,
        isProcessing: true,
      });

      if (window.cv) {
        setPostScanStatus((prev) => ({
          ...prev,
          stage: 'Applying OpenCV processing...',
          progress: 60,
        }));

        try {
          // Create a temporary ID for the canvas
          const tempId = 'temp-opencv-canvas-' + Date.now();
          orientationCorrectedCanvas.id = tempId;

          // Temporarily add the canvas to the DOM if it's not already there
          const isInDom = document.body.contains(orientationCorrectedCanvas);
          if (!isInDom) {
            orientationCorrectedCanvas.style.display = 'none';
            document.body.appendChild(orientationCorrectedCanvas);
          }

          // Use the ID to read the image
          const src = window.cv.imread(tempId);
          const gray = new window.cv.Mat();
          window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

          window.cv.imshow(canvas, gray); // Reuse canvas

          // Clean up OpenCV matrices
          src.delete();
          gray.delete();

          // Remove the temporary canvas from DOM if we added it
          if (!isInDom) {
            document.body.removeChild(orientationCorrectedCanvas);
          }
        } catch (e) {
          console.error('OpenCV processing error:', e);
          // If OpenCV processing fails, still continue with the original image
          canvas.getContext('2d')?.drawImage(orientationCorrectedCanvas, 0, 0);
        }
      } else {
        console.warn('OpenCV not initialized, skipping OpenCV processing.');
        // Just use the original image if OpenCV can't be used
        canvas.getContext('2d')?.drawImage(orientationCorrectedCanvas, 0, 0);
      }

      const correctedSrc = window.cv.imread(orientationCorrectedCanvas);
      const correctedGray = new window.cv.Mat();
      window.cv.cvtColor(
        correctedSrc,
        correctedGray,
        window.cv.COLOR_RGBA2GRAY
      );

      const enhancedCanvas = document.createElement('canvas');
      window.cv.imshow(enhancedCanvas, correctedGray);

      setOriginalImage(orientationCorrectedCanvas.toDataURL('image/png'));
      setEnhancedImage(enhancedCanvas.toDataURL('image/png'));

      setPostScanStatus({
        stage: 'Sending to server...',
        progress: 90,
        isProcessing: true,
      });

      const processedFile = await canvasToFile(enhancedCanvas, result.data);
      await sendToAPI(processedFile, result.data);

      correctedSrc.delete();
      correctedGray.delete();
      canvas.remove();
      enhancedCanvas.remove();

      setPostScanStatus({
        stage: 'Processing complete!',
        progress: 100,
        isProcessing: false,
      });
      setShowScanAgain(true);
      if (event.target) {
        event.target.value = '';
      }
    } catch (err) {
      console.error('Error in handleFileUpload:', err);
      setError(
        err instanceof Error
          ? `Error in handleFileUpload: ${err.message}`
          : 'Failed to process image'
      );
      setShowScanAgain(true);
      setPostScanStatus({
        stage: 'Error processing image',
        progress: 0,
        isProcessing: false,
      });
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleCroppedImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    try {
      const file = event.target.files?.[0];
      if (!file) {
        setError('No file selected');
        return;
      }

      const imageUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setOriginalImage(imageUrl);

      setPostScanStatus({
        stage: 'Image loaded. Please enter encoded string',
        progress: 50,
        isProcessing: false,
      });

      setShowEncodedStringInput(true);
    } catch (err) {
      console.error('Error in handleCroppedImageUpload:', err);
      setError(
        err instanceof Error
          ? `Error in handleCroppedImageUpload: ${err.message}`
          : 'Failed to process cropped image'
      );
      setPostScanStatus({
        stage: 'Error processing image',
        progress: 0,
        isProcessing: false,
      });
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const sendFeedback = async (
    feedback: 'false_positive' | 'false_negative',
    reference_id: any
  ) => {
    try {
      // Replace with your actual API endpoint
      const response = await fetch(
        'https://scan.alemeno.com/noiseqr/feedback/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reference_id,
            feedback,
          }),
        }
      );

      if (response.ok) {
        alert('Feedback submitted successfully');
      } else {
        alert('Failed to submit feedback');
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      alert('Error submitting feedback');
    }
  };

  const submitCroppedImageWithString = async () => {
    try {
      if (!originalImage) {
        setError('No image uploaded');
        return;
      }

      if (!encodedString) {
        setError('Please enter the encoded string');
        return;
      }

      setPostScanStatus({
        stage: 'Sending to server...',
        progress: 70,
        isProcessing: true,
      });

      // Convert data URL to file
      const response = await fetch(originalImage);
      const blob = await response.blob();
      const imageFile = new File([blob], 'cropped-image.png', {
        type: 'image/png',
      });

      setQrData(encodedString);

      await sendToAPI(imageFile, encodedString);

      setEnhancedImage(originalImage);

      setPostScanStatus({
        stage: 'Processing complete!',
        progress: 100,
        isProcessing: false,
      });

      setShowScanAgain(true);
      setShowEncodedStringInput(false);
    } catch (err) {
      console.error('Error in submitCroppedImageWithString:', err);
      setError(
        err instanceof Error
          ? `Error in submitCroppedImageWithString: ${err.message}`
          : 'Failed to process request'
      );
      setShowScanAgain(true);
      setPostScanStatus({
        stage: 'Error processing request',
        progress: 0,
        isProcessing: false,
      });
    }
  };

  const handleScanClick = () => {
    setShowScanner(true);
  };

  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-white">
      {/* Homepage (visible when showScanner is false) */}
      <div
        className={`absolute inset-0 bg-white overflow-hidden ${
          showScanner ? 'hidden' : 'block'
        }`}
      >
        <div className="flex flex-col md:flex-row w-full h-full">
          {/* Left side - Image */}
          <div className="w-full md:w-1/2 flex items-center justify-center">
            <div className="relative w-full md:max-w-none">
              <img
                src="/hero-image.jpg"
                alt="hero-image"
                className="object-cover w-full h-auto md:h-screen"
                loading="eager"
              />
            </div>
          </div>

          {/* Right side - Content */}
          <div className="w-full mt-16 md:w-1/2 flex flex-col items-center md:items-start justify-center px-6 md:px-12">
            <img
              src="/sentinel-logo.png"
              alt="sentinel-logo"
              width="160"
              height="160"
              loading="eager"
            />

            <p className="text-[1rem] text-[#3D3D3D] text-center md:text-left mt-4">
              Scan the QR Fingerprint and verify <br className="md:hidden" />
              whether the product is genuine
            </p>
            <button
              onClick={handleScanClick}
              className="mt-4 px-[2rem] py-[1rem] flex justify-center items-center gap-2 text-sm bg-[#4553ED] text-white rounded-full hover:bg-[#3644DE] transition-colors"
            >
              <img src="/camera.png" alt="camera" width="23" height="23" />
              Scan QR Fingerprint
            </button>
          </div>
        </div>
      </div>

      {/* Scanner App (visible when showScanner is true) */}
      <div
        className={`absolute inset-0 overflow-auto ${
          showScanner ? 'block' : 'hidden'
        }`}
      >
        <div className="min-h-screen bg-gray-50">
          {/* Loading State */}
          {!isOpenCVReady && (
            <div className="fixed top-0 left-0 right-0 bg-blue-500 text-white p-2 text-center animate-pulse">
              Initializing Scanner...
            </div>
          )}

          {/* Main Content */}
          <div className="max-w-md mx-auto p-4">
            {/* Header */}
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-gray-800">
                Scan and verify
              </h1>
              <p
                className="text-[1rem] text-gray-600 mt-1"
                onDoubleClick={() => setShowHiddenFeatures((prev) => !prev)}
              >
                Fit the Sentinel QR Fingerprint in the <br /> square guide and
                keep it in focus
              </p>
            </div>

            {/* Camera View */}
            <div className="relative w-fit mx-auto z-50 rounded-2xl overflow-hidden bg-black shadow-lg">
              <video
                ref={videoRef}
                className="w-96 h-96 object-cover"
                autoPlay
                muted
                playsInline
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
              />

              {/* Guide Overlay - only show when video is active */}
              {videoRef.current &&
              !videoRef.current.paused &&
              !videoRef.current.ended ? (
                <img
                  src="/Guide.png"
                  alt="QR Scanning Guide"
                  className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 p-[5rem]"
                  style={{
                    objectFit: 'contain',
                    opacity: 0.8,
                  }}
                />
              ) : null}

              {/* Camera Access Error Overlay */}
              {noCamera && (
                <div className="absolute text-center inset-0 bg-gray-300 flex flex-col items-center justify-center p-6 z-20">
                  <img
                    src="/no-camera.png"
                    alt="Camera blocked"
                    className="w-20 h-20 mb-4"
                  />
                  <h3 className="text-black text-md mb-2 text-center">
                    Please unblock camera for this website to scan fingerprint
                  </h3>
                  <button
                    className="text-[#4553ED] text-sm"
                    onClick={() =>
                      window.open(
                        'https://support.google.com/chrome/answer/2693767?hl=en',
                        '_blank'
                      )
                    }
                  >
                    How do I unblock camera?
                  </button>
                </div>
              )}
            </div>
            <div className="w-full">
              <ZoomSlider
                savedZoomLevel={savedZoomLevel}
                onZoomChange={handleZoomChange}
              />
            </div>

            {/* Error Display - Always visible */}
            {error && (
              <div className="bg-red-50 mt-5 border border-red-200 rounded-2xl p-4 animate-fadeIn">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {postScanStatus.isProcessing ? (
              <div className="bg-white mt-5 border border-gray-300 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center">
                  <Loader className="w-8 h-8 animate-spin text-blue-500" />
                </div>
                <div>
                  <h4 className="text-[#000000] text-center font-bold text-[1.2rem]">
                    Analyzing QR Fingerprint
                  </h4>
                </div>
              </div>
            ) : analysisResults ? (
              <div>
                {analysisResults.ensemble_score === 1 ? (
                  <div className="bg-white mt-5 border border-gray-300 rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center gap-4">
                      <img
                        src="/genuine.svg"
                        alt="Genuine product"
                        className="w-12 h-12"
                      />
                      <div>
                        <h4 className="text-[#000000] font-bold text-[1.2rem]">
                          Genuine Product
                        </h4>
                        <p className="text-black text-sm">
                          This is a genuine product
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white mt-5 border border-gray-300 rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center gap-4">
                      <img
                        src="/counterfeit.svg"
                        alt="Tampered product"
                        className="w-12 h-12"
                      />
                      <div>
                        <h4 className="text-[#000000] font-bold text-[1.2rem]">
                          Tampering Detected
                        </h4>
                        <p className="text-black text-sm">
                          This product might not be genuine
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Scan Again Button - Always visible */}
            {showScanAgain && !postScanStatus.isProcessing && (
              <>
                <button
                  onClick={startNewScan}
                  className="mt-4 px-[3rem] mx-auto py-[1rem] flex justify-center items-center gap-2 text-[1rem] bg-[#4553ED] text-white rounded-full hover:bg-[#3644DE] transition-colors"
                >
                  Scan Again
                </button>
                {analysisResults && (
                  <div className="my-4 text-xs text-gray-500 flex items-center justify-center gap-2">
                    <span className="tracking-wide">Ref ID:</span>
                    <span className="select-all">
                      {analysisResults?.reference_id || '—'}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Hidden features - only shown when the secret button is clicked */}
            {showHiddenFeatures && (
              <>
                <div className="flex flex-wrap gap-3 mt-4">
                  <select
                    value={zoomLevel}
                    onChange={(e) => handleZoomChange(Number(e.target.value))}
                    className="p-2 relative mb-3 rounded-lg border border-gray-300 bg-white text-black"
                  >
                    {zoomLevels.map((level) => (
                      <option className="text-black" key={level} value={level}>
                        {level}x Zoom
                      </option>
                    ))}
                  </select>

                  <select
                    value={printType}
                    onChange={(e) => handlePrintTypeChange(e.target.value)}
                    className="p-2 relative mb-3 rounded-lg border border-gray-300 bg-white text-black"
                  >
                    <option value="None">None</option>
                    <option value="First Print">First Print</option>
                    <option value="Second Print">Second Print</option>
                  </select>

                  <select
                    value={processingInterval}
                    onChange={(e) =>
                      handleProcessingIntervalChange(Number(e.target.value))
                    }
                    className="p-2 relative mb-3 rounded-lg border border-gray-300 bg-white text-black"
                  >
                    {processingIntervalOptions.map((interval) => (
                      <option
                        className="text-black"
                        key={interval}
                        value={interval}
                      >
                        Interval: {interval}ms
                      </option>
                    ))}
                  </select>

                  <select
                    value={blurHistorySize}
                    onChange={(e) =>
                      handleBlurHistorySizeChange(Number(e.target.value))
                    }
                    className="p-2 relative mb-3 rounded-lg border border-gray-300 bg-white text-black"
                  >
                    {blurHistorySizeOptions.map((size) => (
                      <option className="text-black" key={size} value={size}>
                        Frames: {size}
                      </option>
                    ))}
                  </select>
                </div>

                {analysisResults ? (
                  <div>
                    {analysisResults.ensemble_score === 1 ? (
                      <div className="bg-white mt-5 border border-gray-300 rounded-2xl p-4 flex flex-col">
                        <LongPressButton
                          text="Mark as False Positive"
                          className=" w-full py-3 bg-red-100 text-red-600 font-medium rounded-lg"
                          onLongPress={() =>
                            sendFeedback(
                              'false_positive',
                              analysisResults?.reference_id
                            )
                          }
                        />
                      </div>
                    ) : (
                      <div className="bg-white mt-5 border border-gray-300 rounded-2xl p-4 flex flex-col">
                        <LongPressButton
                          text="Mark as False Negative"
                          className="w-full py-3 bg-green-100 text-green-600 font-medium rounded-lg"
                          onLongPress={() =>
                            sendFeedback(
                              'false_negative',
                              analysisResults?.reference_id
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {/* File Upload */}
                <div className="mt-6">
                  <label className="block text-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 transition-colors cursor-pointer">
                    <Upload className="mx-auto h-6 w-6 text-gray-400" />
                    <span className="mt-2 block text-sm text-gray-600">
                      Or upload QR code image
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={handleFileUpload}
                      onClick={(e) => {
                        (e.target as HTMLInputElement).value = '';
                      }}
                    />
                  </label>
                </div>

                {/* Cropped Image Upload */}
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">
                    Manual Image Upload
                  </h3>
                  <label className="block text-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 transition-colors cursor-pointer">
                    <Upload className="mx-auto h-6 w-6 text-gray-400" />
                    <span className="mt-2 block text-sm text-gray-600">
                      Upload cropped image
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={handleCroppedImageUpload}
                      onClick={(e) => {
                        (e.target as HTMLInputElement).value = '';
                      }}
                    />
                  </label>
                </div>

                {/* Encoded String Input */}
                {showEncodedStringInput && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Enter Encoded String
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={encodedString}
                        onChange={(e) => setEncodedString(e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Paste encoded string here"
                      />
                      <button
                        onClick={submitCroppedImageWithString}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                )}

                {/* Post-Scan Processing */}
                {postScanStatus.isProcessing && (
                  <div className="bg-white rounded-lg shadow-sm p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Loader className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm font-medium">
                          {postScanStatus.stage}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${postScanStatus.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <ImageComparison
                  originalImage={originalImage ?? ''}
                  enhancedImage={enhancedImage ?? ''}
                  paddedImage={paddedImage ?? ''}
                />

                {/* Results Section */}
                {qrData && (
                  <div className="bg-white rounded-lg shadow-sm p-4 animate-fadeIn">
                    <h2 className="text-lg font-semibold text-gray-800 mb-3">
                      Scanned Result
                    </h2>

                    <div className="bg-gray-50 p-3 rounded-lg break-all text-sm">
                      {qrData}
                    </div>

                    <ResultsDisplay results={analysisResults} />
                  </div>
                )}

                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">Scan History</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {scanHistory.map((entry, index) => (
                      <div
                        key={`${entry.timestamp}-${index}`}
                        className={`p-3 rounded-lg shadow-sm ${
                          entry.jsQRStatus.passed
                            ? entry.sizeStatus?.valid &&
                              entry.blurStatus?.passed
                              ? 'bg-green-100'
                              : 'bg-[#f4f4f4]'
                            : 'bg-red-100'
                        }`}
                      >
                        <div className="text-sm text-gray-500">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </div>
                        <div className="text-sm">
                          <div>{entry.jsQRStatus.message}</div>
                          <div>
                            {entry.sizeStatus &&
                              ` - Size: ${entry.sizeStatus.width.toFixed(
                                2
                              )}x${entry.sizeStatus.height.toFixed(
                                2
                              )}   Target: ${SETTINGS.TARGET_QR_SIZE}x${
                                SETTINGS.TARGET_QR_SIZE
                              }`}
                          </div>
                          <div>
                            {entry.blurStatus &&
                              ` - Blur: ${entry.blurStatus.current.toFixed(
                                2
                              )}     Target: ${SETTINGS.BLUR_THRESHOLD}
                        `}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Debug Info */}
                {dimen && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
                    <p className="text-gray-600">
                      {typeof dimen === 'string'
                        ? dimen
                        : JSON.stringify(dimen)}
                    </p>
                  </div>
                )}
                {countRef && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
                    <p className="text-gray-600">
                      Adaptive blur threshold count: {countRef.current} <br />
                      Threshold: {SETTINGS.BLUR_THRESHOLD}
                    </p>
                  </div>
                )}

                {successStatsRef.current && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <h3 className="font-medium text-green-800 mb-2">
                      QR Code Successfully Detected
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-green-700 font-medium mb-1">
                          Successful Method
                        </p>
                        <div className="bg-white border border-green-100 rounded p-2 text-sm">
                          <p className="text-gray-600">
                            {Object.entries(
                              successStatsRef.current.combinations
                            ).sort((a, b) => b[1] - a[1])[0]?.[0] ||
                              'Not Available'}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm text-green-700 font-medium mb-1">
                          Rotation Applied
                        </p>
                        <div className="bg-white border border-green-100 rounded p-2 text-sm">
                          <p className="text-gray-600">
                            {Object.entries(
                              successStatsRef.current.rotations
                            ).sort((a, b) => b[1] - a[1])[0]?.[0] || '0'}
                            ° degrees
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm text-green-700 font-medium mb-1">
                          Best Version
                        </p>
                        <div className="bg-white border border-green-100 rounded p-2 text-sm">
                          <p className="text-gray-600">
                            {Object.entries(
                              successStatsRef.current.versions
                            ).sort((a, b) => b[1] - a[1])[0]?.[0] || 'original'}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-sm text-green-700 font-medium mb-1">
                          Best Hint Configuration
                        </p>
                        <div className="bg-white border border-green-100 rounded p-2 text-sm">
                          <p className="text-gray-600">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-sm text-green-700 font-medium mb-1">
                                  Successful Method
                                </p>
                                <div className="bg-white border border-green-100 rounded p-2 text-sm">
                                  <p className="text-gray-600">
                                    {Object.entries(
                                      successStatsRef.current.combinations
                                    ).sort((a, b) => b[1] - a[1])[0]?.[0] ||
                                      'Not Available'}
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="text-sm text-green-700 font-medium mb-1">
                                  Rotation Applied
                                </p>
                                <div className="bg-white border border-green-100 rounded p-2 text-sm">
                                  <p className="text-gray-600">
                                    {Object.entries(
                                      successStatsRef.current.rotations
                                    ).sort((a, b) => b[1] - a[1])[0]?.[0] ||
                                      '0'}
                                    ° degrees
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="text-sm text-green-700 font-medium mb-1">
                                  Best Version
                                </p>
                                <div className="bg-white border border-green-100 rounded p-2 text-sm">
                                  <p className="text-gray-600">
                                    {Object.entries(
                                      successStatsRef.current.versions
                                    ).length > 0
                                      ? Object.entries(
                                          successStatsRef.current.versions
                                        ).sort((a, b) => b[1] - a[1])[0]?.[0]
                                      : 'original'}
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="text-sm text-green-700 font-medium mb-1">
                                  Best Hint Configuration
                                </p>
                                <div className="bg-white border border-green-100 rounded p-2 text-sm">
                                  <p className="text-gray-600">
                                    {Object.entries(
                                      successStatsRef.current.hints
                                    ).sort((a, b) => b[1] - a[1])[0]?.[0] ||
                                      'TRY_HARDER'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Canvas (Hidden) */}
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>
      </div>
    </div>
  );
};
export default QRScanner;
