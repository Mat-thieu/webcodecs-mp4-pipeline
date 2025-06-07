# WebCodecs MP4 Pipeline

Bare bones implementation of a video rendering pipeline, using only browser APIs.
This project showcases scene composition using canvas, rendering it to MP4 using the native VideoEncoder.
Webworkers and on-the-fly asset retrieval, demuxing and decoding are used to provide non-blocking and efficient video-in-video. 

[Try it out here](https://mat-thieu.github.io/webcodecs-mp4-pipeline/) If you don't have hardware acceleration (A GPU, or the setting is off) your tab may crash. There's a known bug code where the lack of hardware acceleration doesn't impose limits on the amount of cached VideoFrames

![videoframe_8470](https://github.com/user-attachments/assets/32ddd225-0bb8-4e3d-a82e-c841a3a78b2d)

## Features

- Video-in-video
- Efficient memory usage
- Scene composition using HTML canvas
- Audio composition
- Download video as MP4
- Performance metrics at 1920x1080 24fps (prewarmed cache)
- Roughly 3x realtime on a 6-year old, mid-tier laptop
- Roughly 10x realtime on a 5-year old, high-end desktop 

## Backpressure flow

While working on this project I set out to properly implement backpressure for video-in-video, there are a lot of moving parts, and knowing when each part is ready to process more data isn't trivial. Backpressure is the mechanism that ensures memory isn't excessively filled up, the process resides in a chain of the following steps;

- Download chunk of input video (fetch from range)
- Demux chunk of input video (mp4box samples)
- Decode frame from chunks (VideoDecoder)
- Decoded frame is requested by main renderer (message to VideoReader WebWorker)
- Main renderer draws the frame, then frees its memory (Frame transferred from worker is closed)
- Encode new frame in final video (VideoEncoder)
- Mux new data chunk for final video (mp4-muxer)

Each step has its own strategy and sometimes relies on some undocumented features to achieve backpressure. Other times the APIs are too limited, so very short-interval polling is utilized to check queue status.

## Running the project

Nothing to install, all packages come from CDN and there's no bundling.

```bash
# Starts a webserver, will immediately start a render
npm start
```

## Dependency usage 

- [comlink](https://github.com/GoogleChromeLabs/comlink), Straightforward Webworkers with RPC
- [mp4box.js](https://github.com/gpac/mp4box.js/), Demuxing input video(s)
  - To support more input video, it's worth looking into other demuxers. WebM shouldn't be an issue for one
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), Muxing output video

## Todos and other considerations

- Wrap it in a neat library some day
- Currently only a decoder description for AVC codecs is provided
- Use seek for decoder using MOOV box indexing, instead of decoding from start till seek point
- VideoDecoders are being overcrowded a bit, hold onto samples until the queue lowers
- Smarter keyframe insertion. May improve seek performance, allows for better compression
- Split up audio decoding, currently using main thread and clunky, pulling in entire video files to memory at once just to extract audio
- Allow none-faststart video by broadening MOOV-box search
- Allow mismatching FPS between input video and final video, currently not accounted for, always 24fps
- Gradual writing of output file while muxing, currently one large chunk
- HDR, which is now available for canvas behind experimental flags, but other approaches may without flags

