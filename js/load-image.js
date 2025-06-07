export default async function loadImage(src) {
  const img = new Image();
  img.src = src;
  return await new Promise((resolve, reject) => {
      img.onload = () => {
        resolve(img);
      };
      img.onerror = (e) => {
        console.error('Failed to load image:', e);
        reject(e);
      };
  });
}