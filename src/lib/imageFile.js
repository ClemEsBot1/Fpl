// Whether a picked file could be an image. Files saved from some apps
// (the Reddit app, messaging apps) come with no type, a generic one, or
// only an extension, so only a type that is clearly something else is
// turned away; decoding it (ScreenshotScreens.jsx) has the final say.
const IMAGE_EXT = /\.(png|jpe?g|jfif|pjpeg|webp|gif|avif|heic|heif|bmp)$/i;

export function mightBeImage(file) {
  const type = (file && file.type) || '';
  if (type.startsWith('image/')) return true;
  if (IMAGE_EXT.test((file && file.name) || '')) return true;
  return type === '' || type === 'application/octet-stream';
}
