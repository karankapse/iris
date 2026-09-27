import asyncio

import mlx_whisper
import numpy as np


async def transcribe_audio(pcm_data: bytes, sample_rate: int = 16000) -> str:
    """Runs MLX Whisper transcription in a background thread."""

    def _run():
        # Whisper expects 32-bit float array from -1 to 1 at 16kHz
        # The frontend sends 16-bit signed integer PCM
        samples = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0

        # mlx_whisper API: transcribe(audio, path_or_hf_repo="mlx-community/whisper-tiny-mlx")
        result = mlx_whisper.transcribe(samples, path_or_hf_repo="mlx-community/whisper-tiny-mlx")
        return result["text"].strip()

    return await asyncio.to_thread(_run)
