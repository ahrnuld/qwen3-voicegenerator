import logging
import numpy as np
import torch

logger = logging.getLogger(__name__)


class TTSEngine:
    """Singleton wrapper around Qwen3-TTS. Loads the model once and keeps it in VRAM."""

    def __init__(self):
        self._model = None
        self._loaded = False

    def load(self) -> None:
        """Load the model into GPU memory. Called once at app startup."""
        logger.info("Loading Qwen3-TTS model...")
        from qwen_tts import Qwen3TTSModel

        device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        logger.info("Using device: %s  dtype: %s", device_map, dtype)

        self._model = Qwen3TTSModel.from_pretrained(
            "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
            dtype=dtype,
            attn_implementation="sdpa",
            device_map=device_map,
        )
        self._loaded = True
        logger.info("Qwen3-TTS model loaded successfully.")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def generate(
        self,
        text: str,
        speaker: str = "vivian",
        language: str = "auto",
        instruct: str = "",
    ) -> tuple[np.ndarray, int]:
        """
        Run TTS inference.

        Returns:
            (waveform, sample_rate) where waveform is a float32 numpy array.
        """
        if not self._loaded:
            raise RuntimeError("Model is not loaded. Call load() first.")

        # Split long texts on sentence boundaries to avoid OOM
        chunks = _split_text(text)
        audio_parts: list[np.ndarray] = []
        sample_rate: int = 24000  # Qwen3-TTS native output rate

        for chunk in chunks:
            if not chunk.strip():
                continue
            with torch.inference_mode():
                # Returns (List[np.ndarray], int)
                wavs, sr = self._model.generate_custom_voice(
                    text=chunk,
                    speaker=speaker,
                    language=language,
                    instruct=instruct or None,
                )
            sample_rate = sr
            waveform = wavs[0]  # batch size 1
            if isinstance(waveform, torch.Tensor):
                waveform = waveform.float().cpu().numpy()
            audio_parts.append(waveform)

        if not audio_parts:
            raise ValueError("No audio was generated.")

        audio = np.concatenate(audio_parts, axis=-1) if len(audio_parts) > 1 else audio_parts[0]
        return audio, sample_rate


def _split_text(text: str, max_chars: int = 800) -> list[str]:
    """
    Split text into chunks at sentence boundaries to avoid running too much
    through the model at once. Chunks are kept under max_chars where possible.
    """
    import re

    # Split on sentence-ending punctuation
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            # If a single sentence is longer than max_chars, just include it as-is
            current = sentence

    if current:
        chunks.append(current)

    return chunks


# Module-level singleton
engine = TTSEngine()
