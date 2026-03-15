"""
Audio post-processing pipeline.

Each step is independently toggleable. The pipeline runs in order:
  resample → normalize → soft_clip → pseudo_stereo → pad_silence → export
"""

import io
import logging
from typing import Callable

import numpy as np
import torch
import torchaudio

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Individual processing steps
# ---------------------------------------------------------------------------


def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Resample audio to target_sr using torchaudio."""
    if orig_sr == target_sr:
        return audio
    tensor = torch.from_numpy(audio).float()
    if tensor.ndim == 1:
        tensor = tensor.unsqueeze(0)  # (1, T)
    resampler = torchaudio.transforms.Resample(orig_freq=orig_sr, new_freq=target_sr)
    resampled = resampler(tensor)
    result = resampled.squeeze(0).numpy()
    return result


def peak_normalize(audio: np.ndarray) -> np.ndarray:
    """Normalize audio so the peak amplitude is 1.0."""
    peak = np.abs(audio).max()
    if peak < 1e-8:
        return audio
    return audio / peak


def soft_clip(audio: np.ndarray, drive: float = 1.2) -> np.ndarray:
    """Apply tanh soft clipping with the given drive multiplier."""
    return np.tanh(audio * drive)


def make_pseudo_stereo(audio: np.ndarray, sr: int, delay_ms: float = 15.0) -> np.ndarray:
    """
    Create a pseudo-stereo signal from mono by delaying one channel.

    If audio is already 2-D (channels × samples) this is a no-op.
    Returns array of shape (2, T).
    """
    if audio.ndim == 2 and audio.shape[0] == 2:
        return audio  # already stereo

    # Flatten to 1-D if needed
    mono = audio.flatten()
    delay_samples = int(sr * delay_ms / 1000)
    if delay_samples < 1:
        delay_samples = 1

    left = mono
    right = np.concatenate([np.zeros(delay_samples, dtype=mono.dtype), mono[:-delay_samples]])
    return np.stack([left, right], axis=0)  # (2, T)


def pad_silence(audio: np.ndarray, sr: int, lead_ms: float, tail_ms: float) -> np.ndarray:
    """Prepend and/or append silence (zeros) to the audio."""
    lead_samples = int(sr * lead_ms / 1000)
    tail_samples = int(sr * tail_ms / 1000)

    if audio.ndim == 2:
        # (channels, samples)
        lead = np.zeros((audio.shape[0], lead_samples), dtype=audio.dtype)
        tail  = np.zeros((audio.shape[0], tail_samples),  dtype=audio.dtype)
        return np.concatenate([lead, audio, tail], axis=1)
    else:
        lead = np.zeros(lead_samples, dtype=audio.dtype)
        tail  = np.zeros(tail_samples,  dtype=audio.dtype)
        return np.concatenate([lead, audio, tail])


def export_audio(audio: np.ndarray, sr: int, fmt: str = "wav") -> io.BytesIO:
    """
    Encode audio to WAV or MP3 and return a BytesIO buffer.

    audio: numpy array, shape (T,) for mono or (2, T) for stereo.
    Uses soundfile for WAV (avoids torchaudio/torchcodec for encoding).
    """
    import soundfile as sf

    buf = io.BytesIO()

    # soundfile expects (frames, channels) for stereo, or 1-D for mono
    if audio.ndim == 2:
        data = audio.T.astype(np.float32)  # (T, 2)
    else:
        data = audio.astype(np.float32)    # (T,)

    if fmt == "wav":
        sf.write(buf, data, sr, format="WAV", subtype="PCM_16")
    elif fmt == "mp3":
        try:
            from pydub import AudioSegment

            wav_buf = io.BytesIO()
            sf.write(wav_buf, data, sr, format="WAV", subtype="PCM_16")
            wav_buf.seek(0)
            AudioSegment.from_wav(wav_buf).export(buf, format="mp3", bitrate="192k")
        except ImportError as exc:
            raise RuntimeError(
                "MP3 export requires pydub and ffmpeg. Install pydub and ensure ffmpeg is on PATH."
            ) from exc
    else:
        raise ValueError(f"Unsupported format: {fmt!r}. Use 'wav' or 'mp3'.")

    buf.seek(0)
    return buf


# ---------------------------------------------------------------------------
# Pipeline builder
# ---------------------------------------------------------------------------


def build_pipeline(
    upsample: bool,
    target_sr: int,
    normalize: bool,
    soft_clip_enabled: bool,
    soft_clip_drive: float,
    pseudo_stereo: bool,
    stereo_delay_ms: float,
    lead_silence_ms: float,
    tail_silence_ms: float,
    output_format: str,
) -> Callable[[np.ndarray, int], tuple[io.BytesIO, str]]:
    """
    Return a callable that accepts (audio, orig_sr) and returns (BytesIO, content_type).
    """

    def pipeline(audio: np.ndarray, orig_sr: int) -> tuple[io.BytesIO, str]:
        sr = orig_sr

        if upsample:
            logger.debug("Resampling %d → %d Hz", sr, target_sr)
            audio = resample(audio, sr, target_sr)
            sr = target_sr

        if normalize:
            logger.debug("Peak normalizing")
            audio = peak_normalize(audio)

        if soft_clip_enabled:
            logger.debug("Soft clipping (drive=%.2f)", soft_clip_drive)
            audio = soft_clip(audio, drive=soft_clip_drive)

        if pseudo_stereo:
            logger.debug("Pseudo-stereo (delay=%.1f ms)", stereo_delay_ms)
            audio = make_pseudo_stereo(audio, sr, delay_ms=stereo_delay_ms)

        if lead_silence_ms > 0 or tail_silence_ms > 0:
            logger.debug("Padding silence: lead=%.0f ms  tail=%.0f ms", lead_silence_ms, tail_silence_ms)
            audio = pad_silence(audio, sr, lead_silence_ms, tail_silence_ms)

        buf = export_audio(audio, sr, fmt=output_format)
        content_type = "audio/wav" if output_format == "wav" else "audio/mpeg"
        return buf, content_type

    return pipeline
