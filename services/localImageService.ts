
export interface ColorizationResult {
  imageUrl?: string;
  error?: string;
}

// Helper to convert hex to rgb
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Colorizes a base64 grayscale image locally using Canvas API.
 * Maps black pixels to the target color and keeps white pixels white.
 * Includes tunable contrast enhancement.
 * @param base64Image The source image
 * @param targetColorHex The target color
 * @param boldness 0-100, where 50 is default, 100 is maximum threshold (sharp/jagged), 0 is original softness.
 */
export const colorizeImage = async (base64Image: string, targetColorHex: string, boldness: number = 60): Promise<ColorizationResult> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous"; 
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        // optimization for frequent read/write
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (!ctx) {
          resolve({ error: "Browser Canvas context not available" });
          return;
        }

        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const target = hexToRgb(targetColorHex);

        // Map boldness (0-100) to algorithm parameters
        // BLACK_POINT: Pixels darker than this become 100% target color.
        // GAMMA: Curve steepness.
        
        // At boldness 0: Black Point 0, Gamma 1.0 (Linear, softest)
        // At boldness 50: Black Point 100, Gamma 2.0
        // At boldness 100: Black Point 200, Gamma 4.0 (Hard threshold)
        
        const blackPoint = Math.floor((boldness / 100) * 200); 
        const whitePoint = 255 - Math.floor(((100 - boldness) / 100) * 10); // Keep white point mostly high
        const gamma = 1.0 + (boldness / 100) * 3.0; // 1.0 to 4.0

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Skip transparent pixels
          if (a === 0) continue;

          // Calculate human-perceived luminance
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          
          // 1. Linear Normalize based on Black/White points
          let t = (luminance - blackPoint) / (whitePoint - blackPoint);
          
          // Clamp 0 to 1
          if (t < 0) t = 0;
          if (t > 1) t = 1;

          // 2. Apply Power Curve (Gamma)
          if (t > 0 && t < 1) {
             t = Math.pow(t, gamma);
          }

          // Interpolate
          // t=0 => Target Color (Deep)
          // t=1 => White (Background)
          data[i]     = Math.round(target.r * (1 - t) + 255 * t); // Red
          data[i + 1] = Math.round(target.g * (1 - t) + 255 * t); // Green
          data[i + 2] = Math.round(target.b * (1 - t) + 255 * t); // Blue
          // Alpha remains unchanged
        }

        ctx.putImageData(imageData, 0, 0);
        resolve({ imageUrl: canvas.toDataURL('image/png') });
        
      } catch (e: any) {
        console.error("Local processing error:", e);
        resolve({ error: "Failed to process image locally." });
      }
    };
    
    img.onerror = () => {
      resolve({ error: "Failed to load image data." });
    };

    img.src = base64Image;
  });
};
