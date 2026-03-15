from pydantic import BaseModel, Field, field_validator
from typing import Literal


class GenerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Text to synthesize")
    speaker: str = Field(default="vivian", description="Voice/speaker name")
    language: str = Field(default="auto", description="Language for synthesis")
    instruct: str = Field(default="", max_length=500, description="Style/emotion instruction, e.g. 'Speak slowly and warmly'")

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
