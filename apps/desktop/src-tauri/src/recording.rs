// Microphone recording, unlimited duration (SPEC.md > Microphone recording).
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
// Design: capture happens entirely in Rust, on a dedicated thread the
// cpal::Stream never leaves (cpal::Stream is not Send on every backend, so
// it cannot be stored in Tauri-managed state directly) -- samples are
// written straight into an open hound::WavWriter as they arrive, never
// buffered whole in memory, so duration is bounded only by disk space. No
// bytes cross the webview/IPC boundary during recording, and no new
// capabilities.json grant is needed: these are app-defined commands like
// ping/transcribe, not a plugin ACL surface.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Host};
use hound::{SampleFormat as HoundSampleFormat, WavSpec, WavWriter};
use serde::Serialize;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

type WavWriterHandle = Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>;

#[derive(Debug, Serialize)]
pub struct InputDeviceDto {
    pub id: String,
    pub name: String,
}

/// Enumerates input-capable devices by (stable) id and display name. Needs
/// no prior microphone permission on any of the three platforms -- only
/// actually opening an input stream (start_recording) does.
#[tauri::command]
pub fn list_input_devices() -> Result<Vec<InputDeviceDto>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| format!("failed to enumerate input devices: {e}"))?;

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
    Ok(out)
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

fn hound_sample_format(format: cpal::SampleFormat) -> Result<HoundSampleFormat, String> {
    if format.is_float() {
        Ok(HoundSampleFormat::Float)
    } else if matches!(format, cpal::SampleFormat::I8 | cpal::SampleFormat::I16 | cpal::SampleFormat::I32) {
        Ok(HoundSampleFormat::Int)
    } else {
        Err(format!("Unsupported input sample format: {format}"))
    }
}

fn wav_spec_from_config(config: &cpal::SupportedStreamConfig) -> Result<WavSpec, String> {
    Ok(WavSpec {
        channels: config.channels(),
        sample_rate: config.sample_rate(),
        bits_per_sample: (config.sample_format().sample_size() * 8) as u16,
        sample_format: hound_sample_format(config.sample_format())?,
    })
}

// Writes samples straight through with no format conversion -- T is always
// both the sample type read from the device and the type written to the WAV
// file (wav_spec_from_config already set bits_per_sample/sample_format to
// match), same as cpal's own official record_wav.rs example. A lock
// contention or a writer already finalized (post-stop) is silently
// dropped -- a handful of trailing samples lost at the exact moment of stop
// is harmless, and this callback must never block or panic the audio
// thread.
fn write_input_data<T>(input: &[T], writer: &WavWriterHandle)
where
    T: cpal::Sample + hound::Sample + Copy,
{
    if let Ok(mut guard) = writer.try_lock() {
        if let Some(w) = guard.as_mut() {
            for &sample in input.iter() {
                let _ = w.write_sample(sample);
            }
        }
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

/// Starts capturing from `device_id` (falls back to the system default input
/// device if omitted or no longer valid). Setup (device/format resolution,
/// file creation, stream build) happens on a dedicated thread but is
/// reported back synchronously via a one-shot "ready" channel, so a bad
/// device/format surfaces as an Err from this command, not silently inside
/// a detached thread.
#[tauri::command]
pub fn start_recording(app: tauri::AppHandle, device_id: Option<String>) -> Result<(), String> {
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
        let setup = (|| -> Result<(cpal::Stream, WavWriterHandle, u32), String> {
            let device = resolve_device(&host, device_id.as_deref())?;
            let config = device
                .default_input_config()
                .map_err(|e| format!("failed to read default input config: {e}"))?;
            let sample_rate = config.sample_rate();
            let spec = wav_spec_from_config(&config)?;
            let writer = WavWriter::create(&path, spec).map_err(|e| format!("failed to create WAV file: {e}"))?;
            let writer: WavWriterHandle = Arc::new(Mutex::new(Some(writer)));
            let writer_cb = writer.clone();
            let err_fn = |err| eprintln!("[recording] stream error: {err}");
            let stream_config: cpal::StreamConfig = config.clone().into();

            let stream = match config.sample_format() {
                cpal::SampleFormat::I8 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i8], _| write_input_data(data, &writer_cb),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| write_input_data(data, &writer_cb),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i32], _| write_input_data(data, &writer_cb),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| write_input_data(data, &writer_cb),
                    err_fn,
                    None,
                ),
                other => return Err(format!("Unsupported input sample format: {other}")),
            }
            .map_err(|e| format!("failed to open the microphone stream: {e}"))?;

            Ok((stream, writer, sample_rate))
        })();

        let (stream, writer, sample_rate) = match setup {
            Ok(ok) => {
                let _ = ready_tx.send(Ok(()));
                ok
            }
            Err(err) => {
                let _ = ready_tx.send(Err(err.clone()));
                return Err(err);
            }
        };

        stream.play().map_err(|e| format!("failed to start the microphone stream: {e}"))?;

        // Block until stop_recording() signals us (or the sender is
        // dropped, e.g. the app is shutting down) -- either way, proceed to
        // finalize rather than leaving the stream open indefinitely.
        let _ = stop_rx.recv();
        drop(stream);

        let duration_seconds = {
            let mut guard = writer.lock().map_err(|_| "writer lock poisoned".to_string())?;
            let frames = guard.as_ref().map(|w| w.duration()).unwrap_or(0);
            let finished = guard.take();
            drop(guard);
            if let Some(w) = finished {
                w.finalize().map_err(|e| format!("failed to finalize WAV file: {e}"))?;
            }
            frames as f64 / sample_rate as f64
        };

        Ok(RecordingOutcome { path: path_string, duration_seconds })
    });

    // Wait for setup to finish (bounded, so a wedged thread can't hang this
    // command forever) before telling the caller recording has started.
    match ready_rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(Ok(())) => {
            let mut guard = manager.0.lock().map_err(|_| "recording state lock poisoned".to_string())?;
            *guard = Some(RecordingHandle { stop_tx, join_handle });
            Ok(())
        }
        Ok(Err(setup_err)) => Err(setup_err),
        Err(_) => Err("Timed out starting the microphone stream.".to_string()),
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

    #[test]
    fn hound_sample_format_maps_float_formats_to_float() {
        assert_eq!(hound_sample_format(cpal::SampleFormat::F32).unwrap(), HoundSampleFormat::Float);
        assert_eq!(hound_sample_format(cpal::SampleFormat::F64).unwrap(), HoundSampleFormat::Float);
    }

    #[test]
    fn hound_sample_format_maps_supported_int_formats_to_int() {
        assert_eq!(hound_sample_format(cpal::SampleFormat::I8).unwrap(), HoundSampleFormat::Int);
        assert_eq!(hound_sample_format(cpal::SampleFormat::I16).unwrap(), HoundSampleFormat::Int);
        assert_eq!(hound_sample_format(cpal::SampleFormat::I32).unwrap(), HoundSampleFormat::Int);
    }

    // Matches cpal's own record_wav.rs example, which also only handles
    // I8/I16/I32/F32 and errors on everything else (U8/U16/U32/I64/U64/F64
    // included) -- a documented, deliberate scope limit, not an oversight.
    #[test]
    fn hound_sample_format_rejects_unsupported_formats() {
        assert!(hound_sample_format(cpal::SampleFormat::U16).is_err());
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
    fn resolve_device_falls_back_to_default_when_stored_id_is_stale() {
        let host = cpal::default_host();
        let expected_available = host.default_input_device().is_some();
        assert_eq!(
            resolve_device(&host, Some("not-a-real-device-id")).is_ok(),
            expected_available,
        );
    }
}
