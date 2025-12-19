/**
 * AudioWorklet Processor for Live Assistant Mode
 * Captures raw PCM audio samples and sends them to the main thread
 */

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Buffer size: ~300ms at 16kHz = 4800 samples
        // This provides good balance between latency and efficiency
        this.bufferSize = 4800;
        this.buffer = [];

        console.log('AudioProcessor initialized');
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];

        // Check if we have input audio
        if (input && input.length > 0) {
            const channelData = input[0]; // Mono channel

            // Accumulate samples into buffer
            for (let i = 0; i < channelData.length; i++) {
                this.buffer.push(channelData[i]);
            }

            // When buffer is full, send to main thread
            if (this.buffer.length >= this.bufferSize) {
                // Convert to Float32Array for efficient transfer
                const audioData = new Float32Array(this.buffer);

                // Send via message port
                this.port.postMessage(audioData);

                // Clear buffer
                this.buffer = [];
            }
        }

        // Return true to keep processor alive
        return true;
    }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);
