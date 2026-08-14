// Image helpers for user-supplied pictures (profile avatar, playlist covers).
//
// A picked file can be many MB and any aspect ratio. We downscale + center-crop
// it to a small square JPEG data URL so it's cheap to store (base64 in Mongo)
// and renders crisply in a round/rounded frame. Works identically on the web
// and inside the Capacitor WebView — the <input type="file"> that feeds this
// opens the native gallery picker on Android (no storage permission needed on
// modern Android's photo picker).

/** Read a File/Blob as a data URL. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error("Couldn't read the file."));
    fr.readAsDataURL(file);
  });
}

/** Load a data URL / src into an HTMLImageElement. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load that image."));
    img.src = src;
  });
}

/**
 * Downscale + center-crop an image file to a square JPEG data URL.
 *
 * @param {File|Blob} file    the picked image
 * @param {number}    size    output width/height in px (default 256)
 * @param {number}    quality JPEG quality 0..1 (default 0.82)
 * @returns {Promise<string>} `data:image/jpeg;base64,…`
 */
export async function fileToSquareDataUrl(file, size = 256, quality = 0.82) {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // "cover" fit: scale so the shorter side fills the square, center the rest.
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}
