/** Premultiply the derived display buffer before bilinear/mipmap filtering. */
export function premultiplyFieldRGBA(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255;
    pixels[i] = Math.round(pixels[i] * a);
    pixels[i + 1] = Math.round(pixels[i + 1] * a);
    pixels[i + 2] = Math.round(pixels[i + 2] * a);
  }
  return pixels;
}
