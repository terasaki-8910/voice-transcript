import type { OutputFormat, TranscriptResult } from "./types.js";

function formatTimestamp(seconds: number, decimalSeparator: "," | "."): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");

  return `${pad2(h)}:${pad2(m)}:${pad2(s)}${decimalSeparator}${pad3(ms)}`;
}

function renderSrt(result: TranscriptResult): string {
  return result.segments
    .map((seg, i) => {
      const start = formatTimestamp(seg.start, ",");
      const end = formatTimestamp(seg.end, ",");
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join("\n");
}

function renderVtt(result: TranscriptResult): string {
  const cues = result.segments.map((seg) => {
    const start = formatTimestamp(seg.start, ".");
    const end = formatTimestamp(seg.end, ".");
    return `${start} --> ${end}\n${seg.text}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function renderJson(result: TranscriptResult): string {
  return JSON.stringify(
    {
      text: result.text,
      segments: result.segments,
      language: result.language,
      duration: result.duration,
    },
    null,
    2,
  );
}

function renderTxt(result: TranscriptResult): string {
  return result.text;
}

export function render(result: TranscriptResult, format: OutputFormat): string {
  switch (format) {
    case "srt":
      return renderSrt(result);
    case "vtt":
      return renderVtt(result);
    case "json":
      return renderJson(result);
    case "txt":
      return renderTxt(result);
  }
}
