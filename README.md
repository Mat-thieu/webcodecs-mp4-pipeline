# WebCodecs MP4 Pipeline

Bare bones setup of a video rendering pipeline, only using browser APIs (no wasm).
This project showcases end-to-end video-in-video usage.
Compose a scene using multiple videos, these are decoded on-the-fly by workers as the main rendering process requests frames, the main process can then draw frames using canvas to position and modify them as desired. 

## Features

- Video-in-video
- Efficient memory usage
- Scene composition using HTML canvas
- Audio composition
- Roughly 3x realtime performance at 1920x1080 24fps on a 6-year old, mid-tier laptop
- Download video as MP4

## Backpressure flow

While working on this project I set out to properly implement backpressure for video-in-video, there are a lot of moving parts, and knowing when each part is ready to process more data isn't trivial. Backpressure is the mechanism that makes sure memory isn't completely filled up, the process is a chain of the following steps;

- Download chunk of input video (fetch from range)
- Demux chunk of input video (mp4box samples)
- Decode frame from chunks (VideoDecoder)
- Decoded frame is requested by main renderer (message to VideoReader WebWorker)
- Main renderer draws the frame, then frees its memory (Frame transferred from worker is closed)
- Encode new frame in final video (VideoEncoder)
- Mux new data chunk for final video (mp4-muxer)

Each step has its own strategy and sometimes relies on some undocumented features to achieve backpressure. Other times the APIs are too limited to know a change is coming in, and so very short-interval polling is utilized here and there to check queue status.

## Running the project

Nothing to install, all packages come from CDN and there's no bundling.

```bash
# Starts a webserver, will immediately start a render
npm start
```

## Dependency usage

Given there's no native muxing/demuxing APIs, libraries have to fill in there. 

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
