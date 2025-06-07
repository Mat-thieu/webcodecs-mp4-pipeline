import createAudioData from "./create-audio-data.js";

async function handleAudio(muxer, audio) {
  if (!audio || !audio.length) return;
  const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (e) => console.error(e)
  });
  audioEncoder.configure({
      codec: 'opus',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitrate: 128000,
  });

  const audioData = await createAudioData(44100, audio);
  audioEncoder.encode(audioData);
  audioData.close();

  await audioEncoder.flush();
}

async function handleVideo(muxer, canvas, width, height, fps, duration, renderTick) {
  let videoEncoder = new VideoEncoder({
		output: (chunk, meta) => {
			muxer.addVideoChunk(chunk, meta);
		},
		error: (e) => console.error(e)
	});

	videoEncoder.configure({
		codec: 'avc1.640028',
		width,
		height,
		bitrate: 2 * (1024 * 1024), // 2 Mbps
		framerate: fps,
	});

  const totalFrames = duration * fps;
  const totalTime = totalFrames / fps;

  for (let i = 0; i <= totalFrames; i++) {
    const currentTime = i / fps;
    const currentFrame = i;

    // Mechanism to not overcrowd the encode queue, 20 is arbitrary
    if (videoEncoder.encodeQueueSize > 20) {
      await new Promise((resolve) => {
        const poll = setInterval(() => {
          if (videoEncoder.encodeQueueSize < 20) {
            clearInterval(poll);
            resolve();
          }
        });
      });
    }

    await renderTick({ currentTime, currentFrame, totalTime, totalFrames });

    const currentFrameTime = (i / fps) * 1000 * 1000;
    let frame = new VideoFrame(canvas, { timestamp: currentFrameTime });
    videoEncoder.encode(frame, { keyFrame: (currentTime % 8 === 0) }); // Keyframe every 8 seconds, arbitrary

    frame.close();
  }

  await videoEncoder.flush();
}

export default async function renderVideo({
    canvas,
    fileWriter,
    fps,
    duration,
    width,
    height,
    audio,
    renderTick,
}) {
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.StreamTarget({ // todo use chunked writer
      onData: (data, position) => {
          fileWriter.write(new Blob([data]));
      },
      chunked: true,
      chunkSize: (1024 * 1024) * 30,
    }),
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: {
      codec: 'opus',
      numberOfChannels: 2,
      sampleRate: 44100,
    },
    fastStart: false
	});

  await Promise.all([
    handleAudio(muxer, audio),
    handleVideo(muxer, canvas, width, height, fps, duration, renderTick),
  ]);
  
  muxer.finalize();
}
