/**
 * AudioWorklet Processor for Live Assistant Mode
 * Captures raw PCM audio samples and sends them to the main thread
 */

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Buffer size: ~250ms at 16kHz = 4000 samples
        this.bufferSize = 4000;
        this.buffer = [];
        this.lastLog = 0;

        console.log('[AudioProcessor] Initialized');
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];

        // Check if we have input audio
        if (input && input.length > 0) {
            const channelData = input[0]; // Mono channel

            // Calculate RMS for debugging if needed (log once per sec)
            if (Date.now() - this.lastLog > 1000) {
                let sum = 0;
                for (let i = 0; i < channelData.length; i++) {
                    sum += channelData[i] * channelData[i];
                }
                const rms = Math.sqrt(sum / channelData.length);
                if (rms > 0) {
                    console.log(`[AudioProcessor] Capture RMS: ${rms.toFixed(6)}`);
                }
                this.lastLog = Date.now();
            }

            // Accumulate samples into buffer
            for (let i = 0; i < channelData.length; i++) {
                this.buffer.push(channelData[i]);
            }

            // When buffer is full, send to main thread
            if (this.buffer.length >= this.bufferSize) {
                const audioData = new Float32Array(this.buffer);
                this.port.postMessage(audioData);
                this.buffer = [];
            }
        }

        return true;
    }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);
