from pydantic import BaseModel, Field, field_validator
from typing import Literal


class GenerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Text to synthesize")
    mode: Literal["custom_voice", "voice_design", "voice_clone"] = "custom_voice"
    speaker: str = Field(default="vivian", description="Speaker name (custom_voice mode only)")
    language: str = Field(default="auto", description="Language for synthesis")
    instruct: str = Field(default="", max_length=1000, description="Style instruction or voice description")

    # Voice clone (voice_clone mode only)
    ref_audio_b64: str = Field(default="", description="Base64-encoded reference audio file")
    ref_text: str = Field(default="", max_length=2000, description="Transcript of the reference audio (improves quality)")
    x_vector_only: bool = Field(default=False, description="Use speaker embedding only — no reference transcript needed")

    # Post-processing
    upsample: bool = True
    target_sample_rate: int = Field(default=44100, description="Target sample rate after upsampling")
    normalize: bool = True
    soft_clip: bool = True
    soft_clip_drive: float = Field(default=1.2, ge=0.5, le=3.0, description="Tanh drive multiplier")
    pseudo_stereo: bool = True
    stereo_delay_ms: float = Field(default=15.0, ge=1.0, le=50.0, description="Stereo delay in milliseconds")

    # Silence padding
    lead_silence_ms: float = Field(default=0.0, ge=0.0, le=5000.0, description="Silence to prepend in milliseconds")
    tail_silence_ms: float = Field(default=0.0, ge=0.0, le=5000.0, description="Silence to append in milliseconds")

    # Output
    output_format: Literal["wav", "mp3"] = "wav"

    @field_validator("target_sample_rate")
    @classmethod
    def validate_sample_rate(cls, v: int) -> int:
        allowed = {22050, 44100, 48000}
        if v not in allowed:
            raise ValueError(f"target_sample_rate must be one of {allowed}")
        return v
