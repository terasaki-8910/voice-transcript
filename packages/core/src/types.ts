export type OutputFormat = "txt" | "srt" | "vtt" | "json";

export interface Segment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: Segment[];
  language?: string;
  duration?: number;
}

export interface TranscribeParams {
  audio: Uint8Array;
  filename: string;
  model: string;
  language?: string;
}

export interface Transcriber {
  transcribe(params: TranscribeParams): Promise<TranscriptResult>;
}
