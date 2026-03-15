/* -----------------------------------------------------------------------
   Qwen3 TTS — frontend logic
   ----------------------------------------------------------------------- */

const MAX_TEXT_LENGTH = 5000;
const WARN_THRESHOLD  = 0.85;
const STORAGE_KEY     = "qwen3tts_state";

let els = {};
let currentMode = "custom_voice";
let refAudioB64 = "";   // base64-encoded reference audio for voice_clone

function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", () => {
  els = {
    helpBtn:          $("helpBtn"),
    helpPanel:        $("helpPanel"),
    statusDot:        $("statusDot"),
    statusText:       $("statusText"),
    textInput:        $("textInput"),
    charCount:        $("charCount"),
    charMax:          $("charMax"),
    // Custom Voice
    tabCustomVoice:   $("tabCustomVoice"),
    tabVoiceDesign:   $("tabVoiceDesign"),
    panelCustomVoice: $("panelCustomVoice"),
    panelVoiceDesign: $("panelVoiceDesign"),
    speakerSelect:    $("speakerSelect"),
    speakerHint:      $("speakerHint"),
    languageSelect:   $("languageSelect"),
    instructInput:    $("instructInput"),
    // Voice Design
    languageSelectVD: $("languageSelectVD"),
    voiceDescInput:   $("voiceDescInput"),
    // Voice Clone
    tabVoiceClone:    $("tabVoiceClone"),
    panelVoiceClone:  $("panelVoiceClone"),
    languageSelectVC: $("languageSelectVC"),
    fileDrop:         $("fileDrop"),
    refAudioFile:     $("refAudioFile"),
    fileDropText:     $("fileDropText"),
    refAudioPreview:  $("refAudioPreview"),
    xVectorOnly:      $("xVectorOnly"),
    refTextGroup:     $("refTextGroup"),
    refTextInput:     $("refTextInput"),
    // Post-processing
    ppToggle:         $("ppToggle"),
    ppBody:           $("ppBody"),
    upsampleCheck:    $("upsampleCheck"),
    targetSrSelect:   $("targetSrSelect"),
    normalizeCheck:   $("normalizeCheck"),
    softClipCheck:    $("softClipCheck"),
    driveSlider:      $("driveSlider"),
    driveVal:         $("driveVal"),
    stereoCheck:      $("stereoCheck"),
    delaySlider:      $("delaySlider"),
    delayVal:         $("delayVal"),
    leadSilence:      $("leadSilence"),
    tailSilence:      $("tailSilence"),
    // Output / result
    generateBtn:      $("generateBtn"),
    generateLabel:    $("generateLabel"),
    resultCard:       $("resultCard"),
    audioPlayer:      $("audioPlayer"),
    downloadLink:     $("downloadLink"),
    elapsedBadge:     $("elapsedBadge"),
    errorBox:         $("errorBox"),
  };

  els.charCounterEl = document.querySelector(".char-counter");

  initHelp();
  initModeTabs();
  initVoiceClone();
  initSliders();
  initCollapsible();
  initCharCounter();
  initPersistence();
  els.generateBtn.addEventListener("click", handleGenerate);
  loadOptions();
  pollHealth();
});

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

function initModeTabs() {
  [els.tabCustomVoice, els.tabVoiceDesign, els.tabVoiceClone].forEach(tab => {
    tab.addEventListener("click", () => {
      setMode(tab.dataset.mode);
      saveState();
    });
  });
}

function setMode(mode) {
  currentMode = mode;
  [els.tabCustomVoice, els.tabVoiceDesign, els.tabVoiceClone].forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.panelCustomVoice.hidden = mode !== "custom_voice";
  els.panelVoiceDesign.hidden = mode !== "voice_design";
  els.panelVoiceClone.hidden  = mode !== "voice_clone";
}

// ---------------------------------------------------------------------------
// Voice Clone — file upload & drag-drop
// ---------------------------------------------------------------------------

function initVoiceClone() {
  // x-vector toggle hides/shows transcript field
  els.xVectorOnly.addEventListener("change", () => {
    els.refTextGroup.hidden = els.xVectorOnly.checked;
    saveState();
  });

  // File input change
  els.refAudioFile.addEventListener("change", () => {
    const file = els.refAudioFile.files[0];
    if (file) loadRefAudio(file);
  });

  // Drag-and-drop on the label
  els.fileDrop.addEventListener("dragover", e => {
    e.preventDefault();
    els.fileDrop.classList.add("drag-over");
  });
  els.fileDrop.addEventListener("dragleave", () => els.fileDrop.classList.remove("drag-over"));
  els.fileDrop.addEventListener("drop", e => {
    e.preventDefault();
    els.fileDrop.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) loadRefAudio(file);
  });
}

function loadRefAudio(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;                // data:audio/...;base64,XXX
    refAudioB64 = dataUrl.split(",")[1];             // strip the data URL prefix
    els.fileDropText.textContent = file.name;
    els.fileDrop.classList.add("has-file");
    els.refAudioPreview.src = dataUrl;
    els.refAudioPreview.hidden = false;
    saveState();
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveState() {
  const format = document.querySelector('input[name="format"]:checked');
  const state = {
    mode:         currentMode,
    text:         els.textInput.value,
    speaker:      els.speakerSelect.value,
    language:     els.languageSelect.value,
    instruct:     els.instructInput.value,
    languageVD:   els.languageSelectVD.value,
    voiceDesc:    els.voiceDescInput.value,
    languageVC:   els.languageSelectVC.value,
    refAudioB64:  refAudioB64,
    refText:      els.refTextInput.value,
    xVectorOnly:  els.xVectorOnly.checked,
    refFileName:  els.fileDropText.textContent,
    upsample:     els.upsampleCheck.checked,
    targetSr:     els.targetSrSelect.value,
    normalize:    els.normalizeCheck.checked,
    softClip:     els.softClipCheck.checked,
    drive:        els.driveSlider.value,
    stereo:       els.stereoCheck.checked,
    delay:        els.delaySlider.value,
    leadSilence:  els.leadSilence.value,
    tailSilence:  els.tailSilence.value,
    format:       format ? format.value : "wav",
    ppExpanded:   els.ppToggle.getAttribute("aria-expanded") === "true",
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full */ }
}

function restoreState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return; }
  if (!state) return;

  if (state.mode)        setMode(state.mode);
  if (state.text        != null) els.textInput.value        = state.text;
  if (state.instruct    != null) els.instructInput.value    = state.instruct;
  if (state.voiceDesc   != null) els.voiceDescInput.value   = state.voiceDesc;
  if (state.refText     != null) els.refTextInput.value     = state.refText;
  if (state.xVectorOnly != null) {
    els.xVectorOnly.checked    = state.xVectorOnly;
    els.refTextGroup.hidden    = state.xVectorOnly;
  }
  if (state.refAudioB64 && state.refFileName) {
    refAudioB64 = state.refAudioB64;
    els.fileDropText.textContent = state.refFileName;
    els.fileDrop.classList.add("has-file");
    // Restore preview
    els.refAudioPreview.src    = `data:audio/wav;base64,${state.refAudioB64}`;
    els.refAudioPreview.hidden = false;
  }
  if (state.upsample    != null) els.upsampleCheck.checked  = state.upsample;
  if (state.normalize   != null) els.normalizeCheck.checked = state.normalize;
  if (state.softClip    != null) els.softClipCheck.checked  = state.softClip;
  if (state.stereo      != null) els.stereoCheck.checked    = state.stereo;
  if (state.leadSilence != null) els.leadSilence.value      = state.leadSilence;
  if (state.tailSilence != null) els.tailSilence.value      = state.tailSilence;

  if (state.drive != null) {
    els.driveSlider.value    = state.drive;
    els.driveVal.textContent = parseFloat(state.drive).toFixed(1);
  }
  if (state.delay != null) {
    els.delaySlider.value    = state.delay;
    els.delayVal.textContent = state.delay;
  }
  if (state.targetSr != null) els.targetSrSelect.value = state.targetSr;
  if (state.format != null) {
    const radio = document.querySelector(`input[name="format"][value="${state.format}"]`);
    if (radio) radio.checked = true;
  }
  if (state.ppExpanded != null) {
    els.ppToggle.setAttribute("aria-expanded", String(state.ppExpanded));
    els.ppBody.hidden = !state.ppExpanded;
  }

  // Deferred until loadOptions() populates the dropdowns
  els._savedSpeaker    = state.speaker;
  els._savedLanguage   = state.language;
  els._savedLanguageVD = state.languageVD;
  els._savedLanguageVC = state.languageVC;

  updateCharCount();
}

function restoreSelectState() {
  if (els._savedSpeaker)    els.speakerSelect.value    = els._savedSpeaker;
  if (els._savedLanguage)   els.languageSelect.value   = els._savedLanguage;
  if (els._savedLanguageVD) els.languageSelectVD.value = els._savedLanguageVD;
  if (els._savedLanguageVC) els.languageSelectVC.value = els._savedLanguageVC;
  updateSpeakerHint();
}

function initPersistence() {
  restoreState();

  const inputs = [
    els.textInput, els.instructInput, els.voiceDescInput, els.refTextInput,
    els.upsampleCheck, els.normalizeCheck, els.softClipCheck, els.stereoCheck,
    els.driveSlider, els.delaySlider,
    els.targetSrSelect, els.speakerSelect, els.languageSelect, els.languageSelectVD, els.languageSelectVC,
    els.leadSilence, els.tailSilence,
  ];
  inputs.forEach(el => el.addEventListener("input",  saveState));
  inputs.forEach(el => el.addEventListener("change", saveState));
  document.querySelectorAll('input[name="format"]').forEach(r => r.addEventListener("change", saveState));
  els.ppToggle.addEventListener("click", () => setTimeout(saveState, 0));
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

async function pollHealth() {
  setStatus("connecting");
  try {
    const res  = await fetch("/api/health");
    const data = await res.json();

    if (data.model_loaded && data.cuda_available) {
      setStatus("ok", data.cuda_device ? `GPU: ${data.cuda_device}` : "Ready");
      els.generateBtn.disabled = false;
    } else if (data.model_loaded && !data.cuda_available) {
      setStatus("warn", "No GPU — CPU mode");
      els.generateBtn.disabled = false;
    } else {
      setStatus("loading", "Model loading…");
      setTimeout(pollHealth, 3000);
    }
  } catch {
    setStatus("error", "Server unreachable");
    setTimeout(pollHealth, 5000);
  }
}

function setStatus(state, label) {
  const dot  = els.statusDot;
  const text = els.statusText;
  dot.className = "status-dot";
  const map = {
    ok:         ["ok",    label ?? "Ready"],
    warn:       ["busy",  label ?? "Warning"],
    error:      ["error", label ?? "Error"],
    loading:    ["busy",  label ?? "Loading…"],
    connecting: ["",      label ?? "Connecting…"],
    generating: ["busy",  label ?? "Generating…"],
  };
  const [cls, txt] = map[state] ?? ["", state];
  if (cls) dot.classList.add(cls);
  text.textContent = txt;
}

// ---------------------------------------------------------------------------
// Load options from API
// ---------------------------------------------------------------------------

const speakerDescriptions = {};

async function loadOptions() {
  try {
    const res  = await fetch("/api/options");
    const data = await res.json();

    populateSelect(els.speakerSelect, data.speakers);
    populateSelect(els.languageSelect, data.languages);
    populateSelect(els.languageSelectVD, data.languages);
    populateSelect(els.languageSelectVC, data.languages);

    data.speakers.forEach(s => { speakerDescriptions[s.id] = s.description; });

    restoreSelectState();

    els.speakerSelect.addEventListener("change", updateSpeakerHint);

    if (data.max_text_length) {
      els.charMax.textContent = data.max_text_length;
      els.textInput.maxLength = data.max_text_length;
    }
  } catch (err) {
    console.error("Failed to load options:", err);
  }
}

function updateSpeakerHint() {
  els.speakerHint.textContent = speakerDescriptions[els.speakerSelect.value] ?? "";
}

function populateSelect(sel, items) {
  sel.innerHTML = "";
  items.forEach(item => {
    const opt = document.createElement("option");
    if (typeof item === "object") {
      opt.value = item.id;
      opt.textContent = item.label;
    } else {
      opt.value = item;
      opt.textContent = item;
    }
    sel.appendChild(opt);
  });
}

// ---------------------------------------------------------------------------
// Help panel
// ---------------------------------------------------------------------------

function initHelp() {
  els.helpBtn.addEventListener("click", () => {
    const open = els.helpBtn.getAttribute("aria-expanded") === "true";
    els.helpBtn.setAttribute("aria-expanded", String(!open));
    els.helpPanel.hidden = open;
  });
}

// ---------------------------------------------------------------------------
// Collapsible post-processing
// ---------------------------------------------------------------------------

function initCollapsible() {
  els.ppToggle.addEventListener("click", () => {
    const expanded = els.ppToggle.getAttribute("aria-expanded") === "true";
    els.ppToggle.setAttribute("aria-expanded", String(!expanded));
    els.ppBody.hidden = expanded;
  });
}

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

function initSliders() {
  els.driveSlider.addEventListener("input", () => {
    els.driveVal.textContent = parseFloat(els.driveSlider.value).toFixed(1);
  });
  els.delaySlider.addEventListener("input", () => {
    els.delayVal.textContent = els.delaySlider.value;
  });
}

// ---------------------------------------------------------------------------
// Character counter
// ---------------------------------------------------------------------------

function initCharCounter() {
  els.textInput.addEventListener("input", updateCharCount);
  updateCharCount();
}

function updateCharCount() {
  const len  = els.textInput.value.length;
  const max  = parseInt(els.charMax.textContent, 10) || MAX_TEXT_LENGTH;
  const warn = Math.floor(max * WARN_THRESHOLD);
  els.charCount.textContent = len;
  const el = els.charCounterEl;
  if (!el) return;
  el.classList.remove("warn", "limit");
  if (len >= max)       el.classList.add("limit");
  else if (len >= warn) el.classList.add("warn");
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

async function handleGenerate() {
  const text = els.textInput.value.trim();
  if (!text) { showError("Please enter some text."); return; }

  const isVD = currentMode === "voice_design";
  const isVC = currentMode === "voice_clone";

  const voiceDesc = els.voiceDescInput.value.trim();
  if (isVD && !voiceDesc) { showError("Voice Description is required in Voice Design mode."); return; }
  if (isVC && !refAudioB64) { showError("Please upload a reference audio clip for Voice Clone mode."); return; }
  if (isVC && !els.xVectorOnly.checked && !els.refTextInput.value.trim()) {
    showError("Please provide a reference transcript, or enable 'Use voice embedding only'."); return;
  }

  hideError();
  hideResult();
  setGenerating(true);

  if (isVD) setStatus("loading", "Loading Voice Design model…");
  else if (isVC) setStatus("loading", "Loading Voice Clone model…");
  else setStatus("generating");

  const payload = {
    text,
    mode:               currentMode,
    speaker:            els.speakerSelect.value,
    language:           isVD ? els.languageSelectVD.value : isVC ? els.languageSelectVC.value : els.languageSelect.value,
    instruct:           isVD ? voiceDesc : els.instructInput.value.trim(),
    ref_audio_b64:      isVC ? refAudioB64 : "",
    ref_text:           isVC ? els.refTextInput.value.trim() : "",
    x_vector_only:      isVC ? els.xVectorOnly.checked : false,
    upsample:           els.upsampleCheck.checked,
    target_sample_rate: parseInt(els.targetSrSelect.value, 10),
    normalize:          els.normalizeCheck.checked,
    soft_clip:          els.softClipCheck.checked,
    soft_clip_drive:    parseFloat(els.driveSlider.value),
    pseudo_stereo:      els.stereoCheck.checked,
    stereo_delay_ms:    parseFloat(els.delaySlider.value),
    lead_silence_ms:    Math.max(0, parseFloat(els.leadSilence.value) || 0),
    tail_silence_ms:    Math.max(0, parseFloat(els.tailSilence.value) || 0),
    output_format:      document.querySelector('input[name="format"]:checked').value,
  };

  const t0 = performance.now();

  try {
    const res = await fetch("/api/generate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new Error(detail);
    }

    const blob       = await res.blob();
    const url        = URL.createObjectURL(blob);
    const elapsed    = ((performance.now() - t0) / 1000).toFixed(2);
    const serverTime = res.headers.get("X-Generation-Time");
    const displayTime = serverTime ? `${parseFloat(serverTime).toFixed(2)}s` : `${elapsed}s`;

    showResult(url, payload.output_format, displayTime);
    setStatus("ok", "Ready");
  } catch (err) {
    showError(err.message || "An unknown error occurred.");
    setStatus("ok", "Ready");
  } finally {
    setGenerating(false);
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setGenerating(active) {
  els.generateBtn.disabled = active;
  els.generateLabel.innerHTML = active
    ? '<span class="spinner"></span> Generating…'
    : '&#9654; Generate';
}

function showResult(url, ext, elapsed) {
  const prev = els.audioPlayer.src;
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  els.audioPlayer.src = url;
  els.downloadLink.href = url;
  els.downloadLink.download = `tts_output.${ext}`;
  els.elapsedBadge.textContent = `(${elapsed})`;
  els.resultCard.hidden = false;
}

function hideResult() { els.resultCard.hidden = true; }

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = false;
}

function hideError() {
  els.errorBox.hidden = true;
  els.errorBox.textContent = "";
}
