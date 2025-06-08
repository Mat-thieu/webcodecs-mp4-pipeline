export default async function createAudioData(targetSampleRate, audioSources) {
  const numberOfChannels = 2;
  const totalDuration = Math.max(...audioSources.map(source => source.end));

  const audioContext = new OfflineAudioContext(numberOfChannels, targetSampleRate * totalDuration, targetSampleRate);

  await Promise.all(
    audioSources.map(async (source) => {
      try {
        // Fetch the audio data from the provided URL.
        const response = await fetch(source.src);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const bufferSource = audioContext.createBufferSource();
        bufferSource.buffer = audioBuffer;
        
        // --- VOLUME CONTROL ---
        const gainNode = audioContext.createGain();
        gainNode.gain.value = source.volume || 1.0;
        bufferSource.connect(gainNode);
        gainNode.connect(audioContext.destination);

        const duration = source.end - source.start;
        bufferSource.start(source.start, source.seek, duration);
      } catch (error) {
        console.error('Error processing audio source:', source.src, error);
      }
    })
  );

  const audioBuffer = await audioContext.startRendering();

  const totalAudioFrames = audioBuffer.duration * audioBuffer.sampleRate;
  const data = new Float32Array(totalAudioFrames * numberOfChannels);

  // Get channel data
  const channelData = [];
  for (let i = 0; i < numberOfChannels; i++) {
    channelData.push(audioBuffer.getChannelData(i));
  }

  // Interleave the audio data
  for (let i = 0; i < totalAudioFrames; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      data[i * numberOfChannels + channel] = channelData[channel][i];
    }
  }

  let audioData = new AudioData({
      format: 'f32',
      sampleRate: audioBuffer.sampleRate,
      numberOfFrames: totalAudioFrames,
      numberOfChannels: numberOfChannels,
      timestamp: 0,
      data,
  });

  return audioData;
}