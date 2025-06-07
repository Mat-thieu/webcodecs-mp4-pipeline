import * as Comlink from "https://unpkg.com/comlink/dist/esm/comlink.mjs";
import createCanvas from './create-canvas.js';
import renderCanvasImage from './render-canvas-image.js';
import requestTempFile from './request-temp-file.js';
import renderVideo from './render-video.js';
import downloadFile from './download-file.js';
import loadImage from './load-image.js';

async function run() {
    console.log('Starting render...');
    const statusDisplay = document.querySelector('#render-status');
    const renderStartTime = performance.now();

    const { canvas, ctx } = createCanvas(1920, 1080);

    const fileName = 'test.mp4';
    const fileEntry = await requestTempFile(fileName, 30);
    const fileWriter = await new Promise((resolve) => {
        fileEntry.createWriter(resolve);
    });

    const img = await loadImage('./assets/image.png');

    const videoReaderService = Comlink.wrap(
        new Worker('./js/VideoReader.js', { 
          name: JSON.stringify({
            src: `${document.location.protocol}//commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`,
            seek: 20,
            chunkSize: (1024 * 1024) * 1,
            samplesPerChunk: 10,
          }),
        })
    );

    const videoReaderService2 = Comlink.wrap(
        new Worker('./js/VideoReader.js', { 
          name: JSON.stringify({
            src: `${document.location.href}/assets/ForBiggerJoyrides.mp4`,
            seek: 0,
            chunkSize: (1024 * 1024) * 1,
            samplesPerChunk: 10,
          }),
        })
    );

    const duration = 30;
    const fps = 24;
    let tickTime = 0;
    await renderVideo({
        canvas,
        fileWriter,
        width: canvas.width,
        height: canvas.height,
        fps,
        duration,
        audio: [
          {
            src: `${document.location.protocol}//commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`,
            start: 2, // align with video
            end: duration,
            seek: 20, // align with video
            volume: 0.8,
          },
        ],
        renderTick: async ({ currentFrame, totalFrames, currentTime }) => {
            const startTickTime = performance.now();
            const progressFractional = currentFrame / totalFrames;

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // NATIVE
            // Play from 2s into final video
            if (currentTime >= 2) {
              const { frame } = await videoReaderService.consumeFrame();
              ctx.filter = `hue-rotate(${currentFrame % 360}deg)`;
              renderCanvasImage(ctx, frame, {
                width: 1280,
                height: 720,
                x: 520,
                y: 380,
                scale: 1 + (0.2 * progressFractional),
                rotation: 0 + (10 * progressFractional),
                opacity: 0.8 + (0.2 * progressFractional),
              });
              frame.close();
              ctx.filter = 'none';
            }

            if (currentTime >= 4 && currentTime < 14) {
              const { frame } = await videoReaderService2.consumeFrame();
              renderCanvasImage(ctx, frame, {
                width: 1280 / 2,
                height: 720 / 2,
                x: 20,
                y: 80,
                scale: 1 + (0.2 * progressFractional),
                rotation: 0 + (10 * progressFractional),
                opacity: 0.8 + (0.2 * progressFractional),
              });
              frame.close();
            }

            renderCanvasImage(ctx, img, {
                width: img.width / 2,
                height: img.height / 2,
                x: 200,
                y: 820,
                rotation: 0 + (360 * progressFractional),
                opacity: 0.5 + (0.5 * progressFractional),
            });

            // Track the current time and FPS
            ctx.fillStyle = 'black';
            ctx.font = '80px Helvetica, sans-serif';
            ctx.fillText(`Time: ${currentTime.toFixed(2)}s`, 1400, 100);
            ctx.fillText(`Frame: ${currentFrame}f`, 1400, 200);

            // anchor
            ctx.fillStyle = 'red';
            ctx.fillRect(1770, 930, 50, 50);

            // Status display and reader cleanup
            if (progressFractional === 1) {
                statusDisplay.textContent = 'Render complete';
                videoReaderService.flushReader();
                videoReaderService2.flushReader();
            } else {
              statusDisplay.textContent = `
                Rendering status ${(progressFractional * 100).toFixed(2)}% at
                frame ${currentFrame}/${totalFrames} at ${currentTime.toFixed(2)}s
              `;
            }

            tickTime += performance.now() - startTickTime;
        }
    });

    console.log('Average tick time:', (tickTime / (fps * duration)).toFixed(2), 'ms');

    fileWriter.onwriteend = () => {
        fileEntry.file((file) => {
            const renderTime = performance.now() - renderStartTime;

            // Create a download button
            const downloadButton = document.createElement('button');
            downloadButton.textContent = 'Download MP4';
            document.body.appendChild(downloadButton);
            downloadButton.addEventListener('click', () => {
                downloadFile(file, fileName);
            });

            // Create a time to render display
            const timeToRender = document.createElement('div');
            timeToRender.innerHTML = `
                Time to render ${duration}s at ${canvas.width}x${canvas.height} ${fps}fps <b>${(renderTime / 1000).toFixed(2)}</b>s <br />
            `;
            document.body.appendChild(timeToRender);

            // Create a time to render display
            const outputVideo = document.createElement('video');
            outputVideo.src = URL.createObjectURL(file);
            outputVideo.controls = true;
            outputVideo.width = canvas.width / 2;
            document.body.appendChild(outputVideo);
        });
    };
}

window.addEventListener('DOMContentLoaded', run);
