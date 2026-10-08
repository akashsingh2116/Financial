// Checks a chosen document and shrinks large photos so uploads fit the live
// site's request limit (about 4.5 MB on Vercel) and sync quickly on mobile data.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE_PX = 2400;
const JPEG_QUALITY = 0.85;

const TYPE_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
};
export const ACCEPTED_TYPES = Object.values(TYPE_BY_EXT).filter((type, i, all) => all.indexOf(type) === i);

const sizeText = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Some phones report an empty type; fall back to the file extension.
function fileType(file) {
  if (file.type) return file.type.toLowerCase();
  return TYPE_BY_EXT[String(file.name).split('.').pop().toLowerCase()] || '';
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be read. Try a JPG or PNG.')); };
    img.src = url;
  });
}

async function shrinkImage(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNG areas become white, not black, in the JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file;
  const name = String(file.name).replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
}

/**
 * Returns { file } ready to upload (possibly a smaller copy), or { error }
 * explaining why it cannot be used.
 */
export async function prepareUpload(file) {
  if (!file) return { file: null };
  const type = fileType(file);
  if (type === 'image/heic' || type === 'image/heif' || /\.(heic|heif)$/i.test(file.name)) {
    return { error: 'iPhone HEIC photos are not supported. Take a screenshot of it, or set the camera to "Most Compatible", and use that.' };
  }
  if (!ACCEPTED_TYPES.includes(type)) {
    return { error: 'Only JPG, PNG, WEBP, GIF images or PDF files can be attached.' };
  }
  if (file.size === 0) return { error: 'This file is empty.' };

  let ready = file;
  if (type !== 'application/pdf' && type !== 'image/gif' && file.size > SHRINK_ABOVE_BYTES) {
    try {
      ready = await shrinkImage(file);
    } catch (error) {
      return { error: error.message };
    }
  }
  if (ready.size > MAX_UPLOAD_BYTES) {
    return {
      error: type === 'application/pdf'
        ? `This PDF is ${sizeText(ready.size)}. The limit is ${sizeText(MAX_UPLOAD_BYTES)}; compress it or attach a photo of the page.`
        : `This file is ${sizeText(ready.size)} even after shrinking. The limit is ${sizeText(MAX_UPLOAD_BYTES)}.`,
    };
  }
  if (ready.type !== type && ready === file) {
    ready = new File([file], file.name, { type, lastModified: file.lastModified });
  }
  return { file: ready, shrunk: ready !== file && ready.size < file.size ? { from: file.size, to: ready.size } : null };
}
