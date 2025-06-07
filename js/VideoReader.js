importScripts(
  'https://unpkg.com/comlink/dist/umd/comlink.js',
  'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js',
  'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
);

class VideoReader { // Removed "export default"
  src = null;
  // CHUNKING CONFIGURATION
  chunkSize = 0; // chunks of which the video file is read
  fileSize = 0; // Total measured size of the video file
  chunkOffset = 0; // Current chunk offset in the video file
  
  // MP4Box configuration
  mp4boxFile = null; // MP4Box file instance
  videoTrack = null; // Video track
  samplesPerChunk = 0; // Number of samples per chunk
  currentSamples = 0; // Current number of samples processed
  totalSamples = 0; // Total number of samples in the video track

  videoDecoder = null; // VideoDecoder instance

  seek = 0; // TODO proper seek with mp4box, currently cases overhead because up until seek is decoded
  cachedFrames = []; // max 11, appears to be an arbitrary limit in chrome for how many frames can be cached before the decoder halts

  queueCheckDebounced = _.debounce(() => this.checkQueues(), 20);

  nextFrameCb = null;

  flushed = false; // Whether the reader has been flushed
  chunkReadInProgress = false; // Whether a chunk is currently being read

  constructor({
    src = null,
    chunkSize = (1024 * 1024) * 1,
    samplesPerChunk = 10,
    seek = 0,
  }) {
    this.src = src;
    this.chunkSize = chunkSize;
    this.samplesPerChunk = samplesPerChunk;
    this.seek = seek;

    this.init();
  }

  async init() {
    const sample = await this.setupMp4Box();
    await this.setupDecoder(sample);
    this.setupSampleToDecoder();
    this.readChunk();
  }

  async setupMp4Box() {
    console.log("Setting up MP4Box...");
    this.mp4boxFile = MP4Box.createFile();
    this.fileSize = await getFileSize(this.src);

    return await new Promise(async (resolve) => {
      this.mp4boxFile.onReady = async (info) => {
        this.videoTrack = info.tracks.find((track) => track.type === "video");
        if (!this.videoTrack) {
          console.error("No video track found", info.tracks);
          return;
        }
        this.totalSamples = this.videoTrack.nb_samples;
        // console.log({ totalSamples: this.totalSamples, videoDurationInSeconds: this.videoTrack.duration / this.videoTrack.timescale });

        let sample = this.mp4boxFile.getTrackSample(this.videoTrack.id, 0);

        resolve(sample);
      };

      await this.readChunk();
    });
  }

  async setupDecoder(sample) {
    console.log("Setting up video decoder...");
    const decoderDesc = getAvcDecoderDescription(sample);

    this.videoDecoder = new VideoDecoder({
      output: (videoFrame) => this.#handleDecodedFrame(videoFrame),
      error: (e) => console.error(e),
    });

    const decoderConfig = {
      codec: this.videoTrack.codec,
    };
    if (decoderDesc) {
      decoderConfig.description = decoderDesc;
    }
    this.videoDecoder.configure(decoderConfig);
  }

  #handleDecodedFrame(videoFrame) {
    // TODO make sure the sampler doesn't send chunks we don't need. Harder than it seems because we require a keyframe first
    const frameTime = videoFrame.timestamp / this.videoTrack.timescale;
    if (frameTime < this.seek) { // TODO actual seek with mp4box
      videoFrame.close();
      this.queueCheckDebounced();
      return;
    }
    if (this.nextFrameCb) {
      this.nextFrameCb(videoFrame);
    } else {
      this.cachedFrames.push(videoFrame);
    }
    this.queueCheckDebounced();
  }

  async consumeFrame() {
    const frame = this.cachedFrames.shift();
    // If no cached frame, wait until one is available
    if (!frame) {
      return new Promise((resolve) => {
        this.nextFrameCb = (nFrame) => {
          this.nextFrameCb = null;
          resolve(Comlink.transfer({ frame: nFrame }, [nFrame]));
        }
      });
    }
    return Comlink.transfer({ frame }, [frame]);
  }

  setupSampleToDecoder() {
    console.log("Setting up sample extraction...");
    // Extract samples from the video track
    this.mp4boxFile.setExtractionOptions(this.videoTrack.id, "USER_VIDEO_TRACK", {
      nbSamples: this.samplesPerChunk,
    });
    this.mp4boxFile.start();

    // let lastKeyChunk = null;
    this.mp4boxFile.onSamples = (track_id, ref, samples) => {
      samples.forEach((sample) => {
        this.currentSamples++;
        // Create an EncodedVideoChunk with the sample data and dts
        const isKeyChunk = sample.is_sync;
        const encodedChunk = new EncodedVideoChunk({
          type: isKeyChunk ? "key" : "delta",
          timestamp: sample.dts,
          duration: sample.duration,
          data: sample.data.buffer,
        });
        if (this.videoDecoder.state !== "configured") {
          console.error("VideoDecoder is not configured", this.videoDecoder.state, this.src);
        }
        this.videoDecoder.decode(encodedChunk);
        this.mp4boxFile.releaseUsedSamples(this.videoTrack.id, sample.number + 1);

        // Cleanup and flush when all samples
        if (this.currentSamples === this.totalSamples) {
          this.flushReader();
        }
      });

      this.queueCheckDebounced();
    };
  }

  async flushReader() {
    if (this.flushed) return;
    this.flushed = true;

    this.mp4boxFile.flush();
    await this.videoDecoder.flush();
    this.videoDecoder.close();
  }

  checkQueues() {
    const samplerPaused = (this.mp4boxFile.extractedTracks[0].samples.length !== this.samplesPerChunk);
    const decoderPaused = !this.videoDecoder.decodeQueueSize;
    if (samplerPaused && decoderPaused) {
      this.readChunk();
      return;
    }
  }

  async readChunk() {
    if (this.chunkReadInProgress) {
      return;
    }
    if (this.chunkOffset >= this.fileSize) {
      console.log("Reached max size");
      return false;
    }
    this.chunkReadInProgress = true;
    // Ensure the range does not exceed the file size
    const end = Math.min(this.chunkOffset + this.chunkSize - 1, this.fileSize - 1);
    const headers = new Headers();
    if (this.chunkOffset > end) return;
    headers.append("Range", `bytes=${this.chunkOffset}-${end}`);

    try {
      const response = await fetch(this.src, { headers });
      if (!response.ok) {
        this.chunkReadInProgress = false;
        throw new Error("Network response was not ok");
      }
      if (response.status === 416) {
        this.chunkReadInProgress = false;
        console.error("Requested range not satisfiable");
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      arrayBuffer.fileStart = this.chunkOffset;
      this.mp4boxFile.appendBuffer(arrayBuffer);

      this.chunkOffset += this.chunkSize;
      this.chunkReadInProgress = false;
      return true;
    } catch (error) {
      this.chunkReadInProgress = false;
      console.error("Error fetching chunk:", error);
    }
  }
}

function getFileSize(url) {
  return fetch(url, { method: "HEAD" }).then((response) => {
    if (!response.ok) {
      throw new Error("Network response was not ok");
    }
    return parseInt(response.headers.get("Content-Length"), 10);
  });
}

function getAvcDecoderDescription(sample) {
  let avcCBox = null;
  if (!sample) {
    console.error("No track sample found");
    return null;
  }
  if (!sample || !sample.description || !sample.description.avcC) {
    console.warn(
      "Initialization data not found in the first sample or avcC box missing."
    );
    return null;
  }
  let sps = sample.description.avcC.SPS[0].nalu;
  let pps = sample.description.avcC.PPS[0].nalu;

  // Create a new Uint8Array to hold the avcC box
  // 7 bytes for the avcC header, 2 bytes for the SPS length, SPS data, 1 byte for the number of PPS, 2 bytes for the PPS length, and PPS data
  avcCBox = new Uint8Array(7 + 2 + sps.length + 1 + 2 + pps.length);
  // Set up the avcC box structure
  avcCBox[0] = 0x01; // configurationVersion
  avcCBox[1] = sps[1]; // AVCProfileIndication
  avcCBox[2] = sps[2]; // profile_compatibility
  avcCBox[3] = sps[3]; // AVCLevelIndication
  avcCBox[4] = 0xff; // lengthSizeMinusOne, set to 3 indicating the NALUnitLength fields are 4 bytes
  avcCBox[5] = 0xe1; // numOfSequenceParameterSets, the highest bit is reserved and must be set to 1

  // SPS length and data
  avcCBox[6] = (sps.length >> 8) & 0xff; // SPS Length high byte
  avcCBox[7] = sps.length & 0xff; // SPS Length low byte
  avcCBox.set(sps, 8); // SPS NAL Unit

  // PPS length and data
  let ppsStartIndex = 8 + sps.length;
  avcCBox[ppsStartIndex] = 0x01; // numOfPictureParameterSets
  avcCBox[ppsStartIndex + 1] = (pps.length >> 8) & 0xff; // PPS Length high byte
  avcCBox[ppsStartIndex + 2] = pps.length & 0xff; // PPS Length low byte
  avcCBox.set(pps, ppsStartIndex + 3); // PPS NAL Unit

  return avcCBox.buffer;
}

// TODO test 
// function getHevcDecoderDescription(sample) {
//   if (!sample) {
//     console.error("No sample provided for HEVC description.");
//     return null;
//   }
//   if (!sample.description) {
//     console.warn("No sample description found for HEVC.");
//     return null;
//   }

//   // The hvcC box is a property of the sample description entry (e.g., 'hev1', 'hvc1').
//   // sample.description is an MP4Box.SampleEntry (e.g., VisualSampleEntry),
//   // and sample.description.hvcC should be an MP4Box.hvcCBox object.
//   const hvcCBox = sample.description.hvcC;

//   if (!hvcCBox) {
//     console.warn(
//       "HEVC configuration data (hvcC box) not found in sample.description.hvcC. ",
//       "The file might not be HEVC, or mp4box failed to parse the hvcC box."
//     );
//     // You can log sample.description here to inspect its properties if debugging:
//     // console.log("Available boxes in sample description:", sample.description);
//     return null;
//   }

//   if (typeof hvcCBox.getBuffer !== 'function') {
//     console.error(
//       "The hvcCBox object does not have a getBuffer method. ",
//       "It might not be a valid MP4Box.hvcCBox instance from mp4box.js.",
//       hvcCBox
//     );
//     return null;
//   }

//   try {
//     // The getBuffer() method of an MP4Box.Box object serializes it into an ArrayBuffer.
//     // This ArrayBuffer is the HEVCDecoderConfigurationRecord needed by VideoDecoder.
//     const hvcCBuffer = hvcCBox.getBuffer();
    
//     if (!(hvcCBuffer instanceof ArrayBuffer)) {
//         console.error(
//             "hvcCBox.getBuffer() did not return an ArrayBuffer. Actual type: ", 
//             Object.prototype.toString.call(hvcCBuffer)
//         );
//         return null;
//     }
//     return hvcCBuffer;
//   } catch (e) {
//     console.error("Error serializing hvcCBox to ArrayBuffer:", e);
//     return null;
//   }
// }

const options = JSON.parse(self.name);

Comlink.expose(new VideoReader({
  src: options.src,
  chunkSize: options.chunkSize,
  samplesPerChunk: options.samplesPerChunk,
  seek: options.seek,
}));
