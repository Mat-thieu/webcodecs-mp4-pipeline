// Basic layer renderer with some transformations
export default function renderCanvasImage(ctx, img, {
  width = 0,
  height = 0,
  x = 0,
  y = 0,
  rotation = 0,
  scale = 1,
  opacity = 1,
}) {
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const halfWidth = (scaledWidth / 2);
  const halfHeight = (scaledHeight / 2);
  ctx.save();

  ctx.globalAlpha = opacity;
  ctx.translate(x + halfWidth, y + halfHeight);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(
    img,
    -halfWidth,
    -halfHeight,
    scaledWidth,
    scaledHeight
  );
  ctx.restore();
}