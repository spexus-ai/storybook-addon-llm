import html2canvas from 'html2canvas';

const MAX_DIMENSION = 1600;
const MAX_SCALE = 2;

/**
 * Captures a screenshot of the element as a PNG data URL.
 * Throws when the element cannot be captured (hidden, zero-size, unsupported CSS, …).
 */
export async function captureElementScreenshot(element: HTMLElement): Promise<string> {
  if (!element.isConnected) {
    throw new Error('Element is not in the document');
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    throw new Error('Element has no visible size');
  }

  const scale = Math.min(MAX_SCALE, Math.max(1, window.devicePixelRatio || 1));
  const canvas = await html2canvas(element, {
    scale,
    backgroundColor: null,
    logging: false,
  });

  const longestSide = Math.max(canvas.width, canvas.height);
  if (longestSide > MAX_DIMENSION) {
    const ratio = MAX_DIMENSION / longestSide;
    const resized = document.createElement('canvas');
    resized.width = Math.max(1, Math.round(canvas.width * ratio));
    resized.height = Math.max(1, Math.round(canvas.height * ratio));
    const context = resized.getContext('2d');
    if (!context) {
      return canvas.toDataURL('image/png');
    }
    context.drawImage(canvas, 0, 0, resized.width, resized.height);
    return resized.toDataURL('image/png');
  }

  return canvas.toDataURL('image/png');
}
