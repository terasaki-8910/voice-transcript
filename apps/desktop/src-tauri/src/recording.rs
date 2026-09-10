// Audio recording, unlimited duration (SPEC.md > Audio recording).
//
// Captures natively via `cpal` rather than the webview's getUserMedia --
// researched before choosing: WebKitGTK (Linux) has no released Tauri
// version that enables media-stream capture (wry never turns on
// WebKitSettings:enable-media-stream nor wires a permission-request
// handler; still true in wry's unreleased 0.56 dev branch), so a
// webview-capture recorder would silently not work on Linux, one of this
// app's three formal targets. cpal (ALSA/WASAPI/CoreAudio) is the one
// implementation that is uniformly correct across macOS/Windows/Linux, and
// costs no extra macOS setup versus the webview route -- CoreAudio capture
// is gated by the exact same TCC/hardened-runtime mechanism either way (see
// Info.plist/Entitlements.plist next to this crate's Cargo.toml).
//
// Three sources (SPEC.md > Audio recording > Audio source): the microphone,
// the system's own output ("what you hear"), or both mixed into one track.
// System audio is not a second cpal API -- cpal turns an OUTPUT device into
// a capture device when you call build_input_stream on it: WASAPI loopback
// mode on Windows, a Core Audio process tap feeding a private aggregate
// device on macOS 14.6+. ALSA has no such path, so Linux is microphone-only
// and says so up front rather than opening a stream that returns silence.
//
// Design: capture happens entirely in Rust, on a dedicated thread the
// cpal::Stream never leaves (cpal::Stream is not Send on every backend, so
// it cannot be stored in Tauri-managed state directly) -- samples are
// written into an open hound::WavWriter as they arrive, never buffered
// whole in memory, so duration is bounded only by disk space. No bytes
// cross the webview/IPC boundary during recording, and no new
// capabilities.json grant is needed: these are app-defined commands like
// ping/transcribe, not a plugin ACL surface.
//
// Every source runs through the same mixer, including the single-source
// cases -- one path, no "is this the two-source build?" branching. The
// output is always 16-bit mono PCM, because that is what the pipeline
// downstream actually consumes (packages/core/src/audio.ts re-encodes every
// input to 16 kHz mono before upload), and because two capture devices
// cannot be summed without first agreeing on a rate and a channel count
// anyway.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, Host, Sample, SizedSample};
use hound::{SampleFormat as HoundSampleFormat, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// How often the mixer wakes to convert whatever the callbacks have handed
/// it into output frames. Small enough that a stop lands promptly, large
/// enough not to spin.
const MIX_TICK: Duration = Duration::from_millis(50);

/// Longest run of captured-but-not-yet-mixed audio a source may hold before
/// the oldest is dropped. A device whose clock runs fast relative to the
/// wall clock would otherwise grow this buffer for the whole session.
const MAX_BACKLOG_SECONDS: f64 = 1.0;

/// Peak below which a source is reported as having contributed nothing.
/// -80 dBFS: quiet enough that real room tone still counts as signal, loud
/// enough that a denied permission (which yields digital silence, not noise)
/// does not.
const SILENCE_PEAK: f32 = 1e-4;

/// What to capture. Mirrors the webview's AudioSource union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioSource {
    // A webview that sends no source, and any stored setting predating this
    // field, must not start capturing the system's output on its own.
    #[default]
    Microphone,
    System,
    Both,
}

impl AudioSource {
    fn captures_microphone(self) -> bool {
        matches!(self, Self::Microphone | Self::Both)
    }

    fn captures_system(self) -> bool {
        matches!(self, Self::System | Self::Both)
    }
}

/// Whether this platform can capture its own output at all. Windows has
/// WASAPI loopback and macOS 14.6+ has Core Audio process taps, both of
/// which cpal drives through build_input_stream on an output device; ALSA
/// has no equivalent, and PulseAudio/PipeWire monitor sources are not
/// visible to cpal's ALSA host.
#[cfg(target_os = "linux")]
fn system_capture_supported() -> bool {
    false
}

#[cfg(not(target_os = "linux"))]
fn system_capture_supported() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct InputDeviceDto {
    pub id: String,
    pub name: String,
}

fn describe_devices(devices: impl Iterator<Item = Device>) -> Vec<InputDeviceDto> {
    let mut out = Vec::new();
    for device in devices {
        let id = match device.id() {
            Ok(id) => id.to_string(),
            Err(_) => continue, // device disappeared mid-enumeration; skip it, don't fail the whole list
        };
        let name = device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| id.clone());
        out.push(InputDeviceDto { id, name });
    }
    out
}

/// Enumerates input-capable devices by (stable) id and display name. Needs
/// no prior microphone permission on any of the three platforms -- only
/// actually opening an input stream (start_recording) does.
#[tauri::command]
pub fn list_input_devices() -> Result<Vec<InputDeviceDto>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| format!("failed to enumerate input devices: {e}"))?;
    Ok(describe_devices(devices))
}

/// Enumerates output devices -- the things whose playback can be captured.
/// Returns an empty list on platforms with no loopback path rather than an
/// error, so the GUI can render "not available here" without special-casing
/// a failure.
#[tauri::command]
pub fn list_output_devices() -> Result<Vec<InputDeviceDto>, String> {
    if !system_capture_supported() {
        return Ok(Vec::new());
    }
    let host = cpal::default_host();
    let devices = host.output_devices().map_err(|e| format!("failed to enumerate output devices: {e}"))?;
    Ok(describe_devices(devices))
}

fn resolve_device(host: &Host, device_id: Option<&str>) -> Result<Device, String> {
    if let Some(id_str) = device_id {
        if let Ok(id) = id_str.parse() {
            if let Some(device) = host.device_by_id(&id) {
                return Ok(device);
            }
        }
        // Stored device id no longer resolves (unplugged, or a fresh
        // install with a stale localStorage value) -- fall back to the
        // system default input device rather than failing the recording.
    }
    host.default_input_device().ok_or_else(|| "No input (microphone) device available.".to_string())
}

fn resolve_output_device(host: &Host, device_id: Option<&str>) -> Result<Device, String> {
    if let Some(id_str) = device_id {
        if let Ok(id) = id_str.parse() {
            if let Some(device) = host.device_by_id(&id) {
                return Ok(device);
            }
        }
        // Same stale-id fallback as resolve_device above.
    }
    host.default_output_device().ok_or_else(|| "No system audio (output) device available.".to_string())
}

/// Samples handed from an audio callback to the mixer. Already downmixed to
/// mono so the callback -- the one place that knows the device's channel
/// count -- is the only code that has to care about it.
type SharedBuffer = Arc<Mutex<Vec<f32>>>;

// The audio thread must never block or panic, so a lock it cannot take
// immediately means dropping that callback's samples rather than waiting on
// the mixer. The mixer only ever holds this lock for a mem::take, so the
// window is a few nanoseconds wide.
fn push_mono<T>(input: &[T], channels: usize, buffer: &SharedBuffer)
where
    T: Sample,
    f32: FromSample<T>,
{
    if channels == 0 {
        return;
    }
    if let Ok(mut guard) = buffer.try_lock() {
        guard.reserve(input.len() / channels);
        for frame in input.chunks_exact(channels) {
            let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
            guard.push(sum / channels as f32);
        }
    }
}

fn build_capture_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    label: &'static str,
) -> Result<(cpal::Stream, SharedBuffer), String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let buffer: SharedBuffer = Arc::new(Mutex::new(Vec::new()));
    let buffer_cb = buffer.clone();
    let channels = config.channels as usize;
    let stream = device
        .build_input_stream(
            config,
            move |data: &[T], _| push_mono(data, channels, &buffer_cb),
            move |err| eprintln!("[recording] {label} stream error: {err}"),
            None,
        )
        .map_err(|e| format!("failed to open the {label} stream: {e}"))?;
    Ok((stream, buffer))
}

/// Pulls one source's captured audio up to the mixer's rate, tracking the
/// loudest sample it ever produced.
///
/// Linear interpolation, not a windowed sinc: everything here is bound for
/// packages/core's 16 kHz mono re-encode, whose own low-pass discards the
/// band where the difference between the two would show.
struct Resampler {
    pending: Vec<f32>,
    /// Fractional read position within `pending`, carried across ticks so
    /// resampling is continuous rather than restarting each wake-up.
    pos: f64,
    step: f64,
    peak: f32,
    max_backlog: usize,
}

impl Resampler {
    fn new(source_rate: u32, target_rate: u32) -> Self {
        Self {
            pending: Vec::new(),
            pos: 0.0,
            step: source_rate as f64 / target_rate as f64,
            peak: 0.0,
            max_backlog: (source_rate as f64 * MAX_BACKLOG_SECONDS) as usize,
        }
    }

    fn accept(&mut self, mut incoming: Vec<f32>) {
        self.pending.append(&mut incoming);
        if self.pending.len() > self.max_backlog {
            let excess = self.pending.len() - self.max_backlog;
            self.pending.drain(..excess);
            self.pos = (self.pos - excess as f64).max(0.0);
        }
    }

    /// Adds this source's next `out.len()` frames into `out`. Running out of
    /// captured audio leaves the remainder of `out` untouched (silence from
    /// this source) and holds the read position, so the next tick resumes
    /// exactly where this one stopped -- the output stays pinned to the wall
    /// clock instead of drifting behind a slow device.
    fn mix_into(&mut self, out: &mut [f32]) {
        for slot in out.iter_mut() {
            let idx = self.pos.floor() as usize;
            if idx + 1 >= self.pending.len() {
                break;
            }
            let frac = (self.pos - idx as f64) as f32;
            let sample = self.pending[idx] * (1.0 - frac) + self.pending[idx + 1] * frac;
            if sample.abs() > self.peak {
                self.peak = sample.abs();
            }
            *slot += sample;
            self.pos += self.step;
        }
        let consumed = (self.pos.floor() as usize).min(self.pending.len());
        if consumed > 0 {
            self.pending.drain(..consumed);
            self.pos -= consumed as f64;
        }
    }
}

struct Source {
    label: &'static str,
    buffer: SharedBuffer,
    resampler: Resampler,
    // Held only so the stream outlives the mixer loop; cpal stops capture on
    // drop. Never read.
    _stream: cpal::Stream,
}

impl Source {
    fn mix_into(&mut self, out: &mut [f32]) {
        let captured = match self.buffer.try_lock() {
            Ok(mut guard) => std::mem::take(&mut *guard),
            Err(_) => Vec::new(),
        };
        self.resampler.accept(captured);
        self.resampler.mix_into(out);
    }
}

struct RecordingHandle {
    stop_tx: mpsc::Sender<()>,
    join_handle: JoinHandle<Result<RecordingOutcome, String>>,
}

pub struct RecordingManager(Mutex<Option<RecordingHandle>>);

impl RecordingManager {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Debug, Serialize)]
pub struct RecordingOutcome {
    pub path: String,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: f64,
    /// Sources that were requested but produced nothing but digital silence
    /// for the whole recording. macOS grants system-audio capture through
    /// TCC, and a denial there is silent by design -- every Core Audio call
    /// still returns noErr, you simply get zeroes -- so this is the only
    /// signal the GUI can warn on.
    #[serde(rename = "silentSources")]
    pub silent_sources: Vec<String>,
}

fn recordings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("cannot resolve app local data directory: {e}"))?
        .join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create recordings directory: {e}"))?;
    Ok(dir)
}

fn open_source(
    device: &Device,
    config: cpal::SupportedStreamConfig,
    label: &'static str,
    target_rate: u32,
) -> Result<Source, String> {
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.clone().into();
    let (stream, buffer) = match sample_format {
        cpal::SampleFormat::I8 => build_capture_stream::<i8>(device, &stream_config, label),
        cpal::SampleFormat::I16 => build_capture_stream::<i16>(device, &stream_config, label),
        cpal::SampleFormat::I32 => build_capture_stream::<i32>(device, &stream_config, label),
        cpal::SampleFormat::F32 => build_capture_stream::<f32>(device, &stream_config, label),
        other => return Err(format!("Unsupported {label} sample format: {other}")),
    }?;
    Ok(Source {
        label,
        buffer,
        resampler: Resampler::new(config.sample_rate(), target_rate),
        _stream: stream,
    })
}

/// Starts capturing the chosen source(s). Setup (device/format resolution,
/// file creation, stream build) happens on a dedicated thread but is
/// reported back synchronously via a one-shot "ready" channel, so a bad
/// device/format surfaces as an Err from this command, not silently inside
/// a detached thread.
#[tauri::command]
pub fn start_recording(
    app: tauri::AppHandle,
    source: Option<AudioSource>,
    device_id: Option<String>,
    output_device_id: Option<String>,
) -> Result<(), String> {
    let source = source.unwrap_or_default();
    if source.captures_system() && !system_capture_supported() {
        return Err(
            "System audio capture is not available on Linux. Record the microphone instead, or \
             route playback through a PulseAudio/PipeWire monitor source and select it as the \
             microphone."
                .to_string(),
        );
    }

    let manager = app.state::<RecordingManager>();
    {
        let guard = manager.0.lock().map_err(|_| "recording state lock poisoned".to_string())?;
        if guard.is_some() {
            return Err("A recording is already in progress.".to_string());
        }
    }

    let dir = recordings_dir(&app)?;
    let started_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("recording-{started_at_ms}.wav"));
    let path_string = path.to_string_lossy().into_owned();

    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let join_handle = std::thread::spawn(move || -> Result<RecordingOutcome, String> {
        let host = cpal::default_host();
        type Setup = (Vec<Source>, WavWriter<BufWriter<File>>, u32);
        let setup = (|| -> Result<Setup, String> {
            // Resolve every device and format BEFORE opening anything, so
            // the mixer's rate is known when the sources are built.
            let mic = if source.captures_microphone() {
                let device = resolve_device(&host, device_id.as_deref())?;
                let config = device
                    .default_input_config()
                    .map_err(|e| format!("failed to read default input config: {e}"))?;
                Some((device, config))
            } else {
                None
            };
            let system = if source.captures_system() {
                let device = resolve_output_device(&host, output_device_id.as_deref())?;
                // An output device has no input config to read; what it can
                // be captured at is what it plays at.
                let config = device
                    .default_output_config()
                    .map_err(|e| format!("failed to read default output config: {e}"))?;
                Some((device, config))
            } else {
                None
            };

            // Mix at the microphone's own rate when it is in play, so the
            // signal that matters most is the one that is not resampled.
            let target_rate = mic
                .as_ref()
                .map(|(_, c)| c.sample_rate())
                .or_else(|| system.as_ref().map(|(_, c)| c.sample_rate()))
                .ok_or_else(|| "No audio source selected.".to_string())?;

            let mut sources = Vec::new();
            if let Some((device, config)) = mic {
                sources.push(open_source(&device, config, "microphone", target_rate)?);
            }
            if let Some((device, config)) = system {
                sources.push(open_source(&device, config, "system audio", target_rate)?);
            }

            let spec = WavSpec {
                channels: 1,
                sample_rate: target_rate,
                bits_per_sample: 16,
                sample_format: HoundSampleFormat::Int,
            };
            let writer = WavWriter::create(&path, spec).map_err(|e| format!("failed to create WAV file: {e}"))?;
            Ok((sources, writer, target_rate))
        })();

        let (mut sources, mut writer, target_rate) = match setup {
            Ok(ok) => {
                let _ = ready_tx.send(Ok(()));
                ok
            }
            Err(err) => {
                let _ = ready_tx.send(Err(err.clone()));
                return Err(err);
            }
        };

        for src in &sources {
            src._stream
                .play()
                .map_err(|e| format!("failed to start the {} stream: {e}", src.label))?;
        }

        // The output length is driven by the wall clock, not by however many
        // samples the devices happened to deliver: a source that falls
        // behind contributes silence for that stretch rather than pushing
        // everything after it out of sync. With two devices on two
        // independent clocks that is the only alignment that stays true over
        // an hour-long session.
        let started = Instant::now();
        let mut frames_written: u64 = 0;
        let mut mix: Vec<f32> = Vec::new();
        let mut stopped = false;
        while !stopped {
            match stop_rx.recv_timeout(MIX_TICK) {
                // Stop signalled, or the sender was dropped (app shutting
                // down) -- either way do one last pump, then finalize.
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => stopped = true,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }

            let due = (started.elapsed().as_secs_f64() * target_rate as f64) as u64;
            let wanted = due.saturating_sub(frames_written) as usize;
            if wanted == 0 {
                continue;
            }

            mix.clear();
            mix.resize(wanted, 0.0);
            for src in &mut sources {
                src.mix_into(&mut mix);
            }
            for sample in &mix {
                // Summing two full-scale sources can exceed full scale.
                // Clamping (rather than halving both up front) keeps a quiet
                // microphone at its captured level, which matters more to a
                // transcript than the rare instant where both sources peak
                // together.
                let clamped = sample.clamp(-1.0, 1.0);
                writer
                    .write_sample((clamped * i16::MAX as f32) as i16)
                    .map_err(|e| format!("failed to write WAV samples: {e}"))?;
            }
            frames_written += wanted as u64;
        }

        let silent_sources: Vec<String> = sources
            .iter()
            .filter(|s| s.resampler.peak < SILENCE_PEAK)
            .map(|s| s.label.to_string())
            .collect();
        // Drop the streams before finalizing so no callback can be running
        // against a buffer we are done with.
        drop(sources);
        writer.finalize().map_err(|e| format!("failed to finalize WAV file: {e}"))?;

        Ok(RecordingOutcome {
            path: path_string,
            duration_seconds: frames_written as f64 / target_rate as f64,
            silent_sources,
        })
    });

    // Wait for setup to finish (bounded, so a wedged thread can't hang this
    // command forever) before telling the caller recording has started.
    match ready_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => {
            let mut guard = manager.0.lock().map_err(|_| "recording state lock poisoned".to_string())?;
            *guard = Some(RecordingHandle { stop_tx, join_handle });
            Ok(())
        }
        Ok(Err(setup_err)) => Err(setup_err),
        Err(_) => Err("Timed out starting the audio stream.".to_string()),
    }
}

/// Stops the in-progress recording, finalizes the WAV file, and returns its
/// path + duration -- the webview hands the path to the existing queue
/// (addFiles) exactly like a picked file.
#[tauri::command]
pub fn stop_recording(app: tauri::AppHandle) -> Result<RecordingOutcome, String> {
    let manager = app.state::<RecordingManager>();
    let handle = {
        let mut guard = manager.0.lock().map_err(|_| "recording state lock poisoned".to_string())?;
        guard.take().ok_or_else(|| "No recording in progress.".to_string())?
    };

    let _ = handle.stop_tx.send(());
    handle
        .join_handle
        .join()
        .map_err(|_| "recording thread panicked".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(resampler: &mut Resampler, n: usize) -> Vec<f32> {
        let mut out = vec![0.0; n];
        resampler.mix_into(&mut out);
        out
    }

    #[test]
    fn audio_source_selects_the_right_devices() {
        assert!(AudioSource::Microphone.captures_microphone());
        assert!(!AudioSource::Microphone.captures_system());
        assert!(!AudioSource::System.captures_microphone());
        assert!(AudioSource::System.captures_system());
        assert!(AudioSource::Both.captures_microphone());
        assert!(AudioSource::Both.captures_system());
    }

    #[test]
    fn audio_source_defaults_to_microphone_only() {
        // A webview that sends no source at all (or an older stored setting)
        // must not silently start capturing the system's output.
        assert_eq!(AudioSource::default(), AudioSource::Microphone);
    }

    #[test]
    fn matching_rates_pass_samples_through_unchanged() {
        let mut r = Resampler::new(48_000, 48_000);
        r.accept(vec![0.0, 0.25, 0.5, 0.75]);
        let out = drain(&mut r, 3);
        assert_eq!(out, vec![0.0, 0.25, 0.5]);
    }

    #[test]
    fn halving_the_rate_interpolates_between_neighbours() {
        let mut r = Resampler::new(48_000, 24_000);
        r.accept(vec![0.0, 0.1, 0.2, 0.3, 0.4]);
        let out = drain(&mut r, 2);
        assert!((out[0] - 0.0).abs() < 1e-6);
        assert!((out[1] - 0.2).abs() < 1e-6, "expected every second sample, got {out:?}");
    }

    #[test]
    fn doubling_the_rate_yields_midpoints() {
        let mut r = Resampler::new(24_000, 48_000);
        r.accept(vec![0.0, 1.0]);
        let out = drain(&mut r, 2);
        assert!((out[0] - 0.0).abs() < 1e-6);
        assert!((out[1] - 0.5).abs() < 1e-6, "expected the midpoint, got {out:?}");
    }

    #[test]
    fn resampling_stays_continuous_across_ticks() {
        // The fractional read position has to survive between mix_into
        // calls; if it reset each tick the output would stutter every 50ms.
        let mut split = Resampler::new(24_000, 48_000);
        split.accept(vec![0.0, 1.0, 2.0, 3.0]);
        let mut first = drain(&mut split, 2);
        first.extend(drain(&mut split, 2));

        let mut whole = Resampler::new(24_000, 48_000);
        whole.accept(vec![0.0, 1.0, 2.0, 3.0]);
        let expected = drain(&mut whole, 4);

        assert_eq!(first, expected);
    }

    #[test]
    fn a_starved_source_contributes_silence_and_holds_its_place() {
        let mut r = Resampler::new(48_000, 48_000);
        r.accept(vec![0.5, 0.5]);
        // Asked for more than it has: the tail must be silence, not a
        // repeat, and not a panic.
        let out = drain(&mut r, 5);
        assert_eq!(out[0], 0.5);
        assert_eq!(&out[1..], &[0.0, 0.0, 0.0, 0.0]);

        // Late samples resume the stream rather than being dropped.
        r.accept(vec![0.25, 0.25]);
        let out = drain(&mut r, 1);
        assert!(out[0] != 0.0, "expected capture to resume, got {out:?}");
    }

    #[test]
    fn mixing_sums_sources_into_the_same_buffer() {
        let mut a = Resampler::new(48_000, 48_000);
        let mut b = Resampler::new(48_000, 48_000);
        a.accept(vec![0.5, 0.5, 0.5]);
        b.accept(vec![0.25, 0.25, 0.25]);
        let mut out = vec![0.0; 2];
        a.mix_into(&mut out);
        b.mix_into(&mut out);
        assert!((out[0] - 0.75).abs() < 1e-6, "expected a sum, got {out:?}");
    }

    #[test]
    fn backlog_is_bounded_so_a_fast_device_cannot_grow_forever() {
        let mut r = Resampler::new(1_000, 1_000); // 1s cap == 1000 samples
        r.accept(vec![0.1; 4_000]);
        assert_eq!(r.pending.len(), 1_000);
    }

    #[test]
    fn peak_tracks_the_loudest_sample_seen() {
        let mut r = Resampler::new(48_000, 48_000);
        assert!(r.peak < SILENCE_PEAK, "a source that never ran must read as silent");
        r.accept(vec![0.0, -0.8, 0.3, 0.0]);
        drain(&mut r, 3);
        assert!((r.peak - 0.8).abs() < 1e-6, "peak should be absolute, got {}", r.peak);
    }

    #[test]
    fn digital_silence_stays_below_the_silence_threshold() {
        // The macOS TCC-denial case: the stream opens and delivers frames,
        // they are just all zero.
        let mut r = Resampler::new(48_000, 48_000);
        r.accept(vec![0.0; 128]);
        drain(&mut r, 64);
        assert!(r.peak < SILENCE_PEAK);
    }

    #[test]
    fn push_mono_averages_interleaved_channels() {
        let buffer: SharedBuffer = Arc::new(Mutex::new(Vec::new()));
        push_mono(&[1.0f32, 0.0, 0.5, 0.5], 2, &buffer);
        assert_eq!(*buffer.lock().unwrap(), vec![0.5, 0.5]);
    }

    #[test]
    fn resolve_device_falls_back_to_default_when_no_id_given() {
        let host = cpal::default_host();
        // This machine may or may not have an input device (e.g. a CI
        // runner); either way, resolve_device's behavior with no id must
        // match default_input_device()'s own availability, never panic.
        let expected_available = host.default_input_device().is_some();
        assert_eq!(resolve_device(&host, None).is_ok(), expected_available);
    }

    #[test]
    fn resolve_output_device_falls_back_to_default_when_no_id_given() {
        let host = cpal::default_host();
        let expected_available = host.default_output_device().is_some();
        assert_eq!(resolve_output_device(&host, None).is_ok(), expected_available);
    }

    #[test]
    fn linux_reports_system_capture_as_unavailable() {
        // Pins the platform split the GUI's copy and start_recording's error
        // message both depend on.
        assert_eq!(system_capture_supported(), !cfg!(target_os = "linux"));
    }
}
