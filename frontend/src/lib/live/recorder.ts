// Push-to-talk microphone capture as 16 kHz mono WAV, the format Anir STT takes (MediaRecorder gives
// WebM/Opus in Chromium, which Anir doesn't accept).

const TARGET_RATE = 16_000;

export interface Recording {
  /** Stop and return the WAV clip. */
  stop(): Promise<Blob>;
  /** Stop and throw the audio away. */
  cancel(): void;
  /** Recent input level 0..1, for a live meter. */
  level(): number;
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but works in every browser without a separate worklet file.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let peak = 0;

  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(samples));
    peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  };
  source.connect(processor);
  processor.connect(context.destination);

  const release = () => {
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };

  return {
    async stop() {
      release();
      return encodeWav(downsample(merge(chunks), context.sampleRate, TARGET_RATE), TARGET_RATE);
    },
    cancel: release,
    level: () => peak,
  };
}

function merge(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Average-pooling resample; good enough for speech going to STT. */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const clipped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return new Blob([view.buffer], { type: "audio/wav" });
}
