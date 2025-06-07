
// function applyRetinaScaling(canvas, ctx) {
//     const ratio = window.devicePixelRatio;
//     canvas.style.width = `${canvas.width}px`;
//     canvas.style.height = `${canvas.height}px`;
//     canvas.width = canvas.width * ratio;
//     canvas.height = canvas.height * ratio;
//     ctx.scale(ratio, ratio);
// }

export default function initCanvas(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // applyRetinaScaling(canvas, ctx);

    return { canvas, ctx };
}
