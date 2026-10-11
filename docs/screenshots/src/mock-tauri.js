// Mock of Tauri v2's webview-side IPC surface, injected via
// page.addInitScript() before any app code runs. Implements just enough of
// window.__TAURI_INTERNALS__ for @tauri-apps/api/core's invoke()/
// transformCallback(), @tauri-apps/api/event's listen()/emit(), and the
// dialog / clipboard-manager plugins to resolve against realistic demo
// data instead of a real Tauri host.
//
// Demo data is entirely invented (no real user data). Japanese UI shots
// read the ja dataset, English UI shots read the en dataset -- selected at
// call time from localStorage's "voice-transcript-lang" key, the same key
// I18nContext itself reads.
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Demo datasets
  // ---------------------------------------------------------------------

  const JA_TRANSCRIPT_SEMINAR = [
    "それでは今日の研究室ゼミを始めます。テーマは知識グラフとSPARQLクエリ、それからMCPサーバーを使った検索の自動化についてです。",
    "まず背景ですが、我々のグループではライフサイエンス分野のオープンデータを統合するために、RDFトリプルストアの上にSPARQLエンドポイントを構築しています。遺伝子・化合物・疾患の関連を横断的に検索できるのが利点です。",
    "ここで一つ訂正があります。先週の議事録で「2GOMCP」という表記が出てきますが、これは聞き起こしの誤りで、正しくは「TogoMCP」です。ライフサイエンス統合データベースTogoDBのMCPサーバー実装を指しています。",
    "TogoMCPを使うと、Claude やその他のLLMエージェントから直接SPARQLクエリを発行して、遺伝子IDから関連文献を引けるようになります。これにより、研究者が手作業でクエリを書く手間がかなり減ります。",
    "質疑応答に移ります。クエリのタイムアウトはどう扱っていますか、という質問がありました。現在は30秒でタイムアウトし、部分結果をキャッシュしてから再試行する設計になっています。",
    "次回は、このMCPサーバーをWhisperの文字起こしパイプラインと組み合わせて、議事録から自動的に関連文献を提示するデモを行う予定です。今日はここまでにします。お疲れ様でした。",
  ].join("\n\n");

  const JA_TRANSCRIPT_DB_LECTURE = [
    "データベース論、第3回の講義を始めます。今日はリレーショナルモデルと正規化についてです。",
    "第1正規形、第2正規形、第3正規形の違いを具体例で確認しましょう。学生テーブルと履修テーブルを分離することで、更新時異状を防げます。",
    "次回は索引とクエリ最適化について触れる予定です。",
  ].join("\n\n");

  const JA_TRANSCRIPT_INTERVIEW = [
    "では面接練習を始めます。まず自己紹介をお願いできますか。",
    "はい、情報科学研究科修士2年の田中と申します。専門は自然言語処理で、音声認識モデルの誤り訂正をテーマに研究しています。",
    "ありがとうございます。研究の中で一番苦労した点を教えてください。",
    "長時間音声のチャンク分割と、チャンク間の文脈の整合性を保つ部分に苦労しました。",
  ].join("\n\n");

  const JA_TRANSCRIPT_SHORT_REC = [
    "これはテスト録音です。マイクの音量を確認しています。1、2、3、聞こえていますか。",
    "次に、システム音声の録音もテストします。問題なければ本番の収録に移ります。",
  ].join("\n\n");

  const jaHistory = [
    {
      id: 101,
      sourceFileName: "/Users/demo/recordings/研究室ゼミ_2026-10-06.m4a",
      startedAt: "2026-10-06T19:02:00+09:00",
      model: "whisper-large-v3-turbo",
      language: "ja",
      formats: ["txt"],
      status: "success",
      transcriptText: JA_TRANSCRIPT_SEMINAR,
      title: null,
      noteCount: 1,
    },
    {
      id: 102,
      sourceFileName: "/Users/demo/recordings/lecture-week3.m4a",
      startedAt: "2026-09-29T14:10:00+09:00",
      model: "whisper-large-v3",
      language: "ja",
      formats: ["txt"],
      status: "success",
      transcriptText: JA_TRANSCRIPT_DB_LECTURE,
      title: "データベース論 第3回",
      noteCount: 1,
    },
    {
      id: 103,
      sourceFileName: "/Users/demo/recordings/interview-practice-draft.m4a",
      startedAt: "2026-09-25T11:30:00+09:00",
      model: "whisper-large-v3-turbo",
      language: "ja",
      formats: ["txt"],
      status: "success",
      transcriptText: JA_TRANSCRIPT_INTERVIEW,
      title: "インタビュー練習",
      noteCount: 0,
    },
    {
      id: 104,
      sourceFileName: "/Users/demo/recordings/recording-1791180038337.wav",
      startedAt: "2026-09-20T09:05:00+09:00",
      model: "whisper-large-v3-turbo",
      language: "ja",
      formats: ["txt"],
      status: "success",
      transcriptText: JA_TRANSCRIPT_SHORT_REC,
      title: null,
      noteCount: 0,
    },
    {
      id: 105,
      sourceFileName: "/Users/demo/recordings/lecture-week5.m4a",
      startedAt: "2026-09-18T14:05:00+09:00",
      model: "whisper-large-v3",
      language: "ja",
      formats: ["txt"],
      status: "failed",
      transcriptText: null,
      title: "データベース論 第5回",
      noteCount: 0,
    },
  ];

  const jaNotesByTranscription = {
    101: [
      {
        id: 9001,
        transcriptionId: 101,
        startOffset: JA_TRANSCRIPT_SEMINAR.indexOf("2GOMCP"),
        endOffset: JA_TRANSCRIPT_SEMINAR.indexOf("2GOMCP") + "2GOMCP".length,
        quotedText: "2GOMCP",
        note: "TogoMCP の聞き間違い",
        createdAt: "2026-10-06T19:40:00+09:00",
        updatedAt: "2026-10-06T19:40:00+09:00",
      },
    ],
    102: [
      {
        id: 9002,
        transcriptionId: 102,
        startOffset: JA_TRANSCRIPT_DB_LECTURE.indexOf("正規化"),
        endOffset: JA_TRANSCRIPT_DB_LECTURE.indexOf("正規化") + "正規化".length,
        quotedText: "正規化",
        note: "SPARQLとTogoMCPの比較は期末試験に出る",
        createdAt: "2026-09-29T15:05:00+09:00",
        updatedAt: "2026-09-29T15:05:00+09:00",
      },
    ],
  };

  const jaDictionary = [
    { id: 1, word: "2GOMCP", replacement: "TogoMCP", createdAt: "2026-10-06T19:41:00+09:00", updatedAt: "2026-10-06T19:41:00+09:00" },
    { id: 2, word: "スパークル", replacement: "SPARQL", createdAt: "2026-09-29T15:00:00+09:00", updatedAt: "2026-09-29T15:00:00+09:00" },
    { id: 3, word: "ウィスパー", replacement: "Whisper", createdAt: "2026-09-20T10:00:00+09:00", updatedAt: "2026-09-20T10:00:00+09:00" },
    { id: 4, word: "グロック", replacement: "Groq", createdAt: "2026-09-18T10:00:00+09:00", updatedAt: "2026-09-18T10:00:00+09:00" },
  ];

  const EN_TRANSCRIPT_SEMINAR = [
    "Let's start today's lab seminar. The topic is knowledge graphs, SPARQL queries, and automating literature search with an MCP server.",
    "As background: our group is building a SPARQL endpoint over an RDF triple store to integrate open life-science data, so we can cross-search genes, compounds, and diseases.",
    "One correction first. Last week's notes have a mis-transcription, \"2GOMCP\" -- that should read \"TogoMCP\". It refers to the MCP server implementation built on top of the TogoDB life-science integration database.",
    "With TogoMCP, an LLM agent like Claude can issue SPARQL queries directly and pull related literature straight from a gene ID, which saves a lot of manual query-writing.",
    "On to questions. Someone asked how we handle query timeouts -- right now we time out at 30 seconds, cache the partial result, and retry once.",
    "Next time we'll demo combining this MCP server with the Whisper transcription pipeline, so meeting notes automatically surface related literature. That's it for today, thanks everyone.",
  ].join("\n\n");

  const EN_TRANSCRIPT_DB_LECTURE = [
    "Welcome to Database Theory, session 3. Today: the relational model and normalization.",
    "Let's walk through first, second, and third normal form with a concrete example. Splitting the students table from the enrollments table avoids update anomalies.",
    "Next time we'll cover indexing and query optimization.",
  ].join("\n\n");

  const EN_TRANSCRIPT_INTERVIEW = [
    "Let's start the mock interview. Could you introduce yourself first?",
    "Sure -- I'm a second-year master's student in computer science. My focus is NLP, specifically error correction for speech recognition output.",
    "Thanks. What was the hardest part of your research so far?",
    "Splitting long audio into chunks while keeping context consistent across chunk boundaries was the hard part.",
  ].join("\n\n");

  const EN_TRANSCRIPT_SHORT_REC = [
    "This is a test recording. Checking the microphone level. One, two, three, can you hear this?",
    "Now testing system-audio capture as well. If that's clean, we'll move on to the real recording.",
  ].join("\n\n");

  const enHistory = [
    {
      id: 101,
      sourceFileName: "/Users/demo/recordings/lab-seminar-2026-10-06.m4a",
      startedAt: "2026-10-06T19:02:00+09:00",
      model: "whisper-large-v3-turbo",
      language: "en",
      formats: ["txt"],
      status: "success",
      transcriptText: EN_TRANSCRIPT_SEMINAR,
      title: null,
      noteCount: 1,
    },
    {
      id: 102,
      sourceFileName: "/Users/demo/recordings/lecture-week3.m4a",
      startedAt: "2026-09-29T14:10:00+09:00",
      model: "whisper-large-v3",
      language: "en",
      formats: ["txt"],
      status: "success",
      transcriptText: EN_TRANSCRIPT_DB_LECTURE,
      title: "Database Theory, Session 3",
      noteCount: 1,
    },
    {
      id: 103,
      sourceFileName: "/Users/demo/recordings/interview-practice-draft.m4a",
      startedAt: "2026-09-25T11:30:00+09:00",
      model: "whisper-large-v3-turbo",
      language: "en",
      formats: ["txt"],
      status: "success",
      transcriptText: EN_TRANSCRIPT_INTERVIEW,
      title: "Interview practice",
      noteCount: 0,
    },
    {
      id: 104,
      sourceFileName: "/Users/demo/recordings/recording-1791180038337.wav",
      startedAt: "2026-09-20T09:05:00+09:00",
      model: "whisper-large-v3-turbo",
      language: "en",
      formats: ["txt"],
      status: "success",
      transcriptText: EN_TRANSCRIPT_SHORT_REC,
      title: null,
      noteCount: 0,
    },
    {
      id: 105,
      sourceFileName: "/Users/demo/recordings/lecture-week5.m4a",
      startedAt: "2026-09-18T14:05:00+09:00",
      model: "whisper-large-v3",
      language: "en",
      formats: ["txt"],
      status: "failed",
      transcriptText: null,
      title: "Database Theory, Session 5",
      noteCount: 0,
    },
  ];

  const enNotesByTranscription = {
    101: [
      {
        id: 9001,
        transcriptionId: 101,
        startOffset: EN_TRANSCRIPT_SEMINAR.indexOf("2GOMCP"),
        endOffset: EN_TRANSCRIPT_SEMINAR.indexOf("2GOMCP") + "2GOMCP".length,
        quotedText: "2GOMCP",
        note: "Mis-heard: should be TogoMCP",
        createdAt: "2026-10-06T19:40:00+09:00",
        updatedAt: "2026-10-06T19:40:00+09:00",
      },
    ],
    102: [
      {
        id: 9002,
        transcriptionId: 102,
        startOffset: EN_TRANSCRIPT_DB_LECTURE.indexOf("normalization"),
        endOffset: EN_TRANSCRIPT_DB_LECTURE.indexOf("normalization") + "normalization".length,
        quotedText: "normalization",
        note: "The SPARQL vs TogoMCP comparison will be on the final exam",
        createdAt: "2026-09-29T15:05:00+09:00",
        updatedAt: "2026-09-29T15:05:00+09:00",
      },
    ],
  };

  const enDictionary = [
    { id: 1, word: "2GOMCP", replacement: "TogoMCP", createdAt: "2026-10-06T19:41:00+09:00", updatedAt: "2026-10-06T19:41:00+09:00" },
    { id: 2, word: "sparkle", replacement: "SPARQL", createdAt: "2026-09-29T15:00:00+09:00", updatedAt: "2026-09-29T15:00:00+09:00" },
    { id: 3, word: "whispr", replacement: "Whisper", createdAt: "2026-09-20T10:00:00+09:00", updatedAt: "2026-09-20T10:00:00+09:00" },
    { id: 4, word: "grock", replacement: "Groq", createdAt: "2026-09-18T10:00:00+09:00", updatedAt: "2026-09-18T10:00:00+09:00" },
  ];

  function dataset() {
    const lang = window.localStorage.getItem("voice-transcript-lang") === "ja" ? "ja" : "en";
    if (lang === "ja") {
      return { history: state.jaHistory, notes: state.jaNotes, dictionary: state.jaDictionary };
    }
    return { history: state.enHistory, notes: state.enNotes, dictionary: state.enDictionary };
  }

  // Mutable, per-session copies (deep clone so repeated page loads in the
  // same test run don't leak edits across screenshots).
  const state = {
    jaHistory: clone(jaHistory),
    enHistory: clone(enHistory),
    jaNotes: clone(jaNotesByTranscription),
    enNotes: clone(enNotesByTranscription),
    jaDictionary: clone(jaDictionary),
    enDictionary: clone(enDictionary),
    nextNoteId: 9100,
    nextDictionaryId: 100,
    dialogOpenCallCount: 0,
  };

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  // ---------------------------------------------------------------------
  // Queue / transcribe behavior, keyed by the basename of the file path
  // QueueContext passes to transcribe(). Drives the Queue screenshot's
  // mixed states: a fast success, a fast failure, and a transcribe() call
  // that never resolves (used to hold one row in "transcribing" and one
  // behind it in "queued" -- see shots script for why).
  // ---------------------------------------------------------------------
  const QUEUE_BEHAVIOR = {
    "seminar-week6-recording.wav": { mode: "done" },
    "interview-practice-draft.m4a": { mode: "fail" },
    "lecture-week5.m4a": { mode: "hang" },
    "recording-1791180038337.wav": { mode: "hang" }, // never reached (behind the hang above)
  };

  // Drives "plugin:dialog|open" (pickFiles()) below: first "Add files"
  // click returns a fast-success + fast-failure pair, second click
  // returns a never-resolving file followed by one that therefore stays
  // "queued" forever -- see QUEUE_BEHAVIOR above.
  const DIALOG_OPEN_SEQUENCE = [
    ["/Users/demo/recordings/seminar-week6-recording.wav", "/Users/demo/recordings/interview-practice-draft.m4a"],
    ["/Users/demo/recordings/lecture-week5.m4a", "/Users/demo/recordings/recording-1791180038337.wav"],
  ];

  function basename(p) {
    const parts = String(p).split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }

  // ---------------------------------------------------------------------
  // IPC plumbing: transformCallback registry + invoke dispatcher.
  // ---------------------------------------------------------------------
  let nextCallbackId = 1;
  const callbacks = new Map(); // id -> { fn, once }
  const eventListeners = new Map(); // eventName -> Set<callbackId>
  let nextEventListenerId = 1;

  function transformCallback(callback, once) {
    const id = nextCallbackId++;
    callbacks.set(id, { fn: callback, once: !!once });
    return id;
  }

  function unregisterCallback(id) {
    callbacks.delete(id);
  }

  // Exposed for the capture script to drive event-based UI (recording
  // level meter, auto-stop, source-silence) exactly the way the real
  // Rust side would via emit().
  window.__mockEmit = function (eventName, payload) {
    const ids = eventListeners.get(eventName);
    if (!ids) return;
    for (const id of ids) {
      const entry = callbacks.get(id);
      if (!entry) continue;
      entry.fn({ event: eventName, payload, id });
      if (entry.once) {
        callbacks.delete(id);
      }
    }
  };

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function mockInvoke(cmd, args) {
    args = args || {};

    switch (cmd) {
      case "ping":
        return "pong";

      case "transcribe": {
        const req = args.request || {};
        const name = basename(req.filePath);
        const behavior = QUEUE_BEHAVIOR[name] || { mode: "done" };
        if (behavior.mode === "hang") {
          // Simulates a transcription that's genuinely still running --
          // never resolves for the lifetime of the demo page.
          return new Promise(() => {});
        }
        await delay(500);
        if (behavior.mode === "fail") {
          throw new Error("Groq API request failed: exhausted retries");
        }
        const isJa = window.localStorage.getItem("voice-transcript-lang") === "ja";
        const text = isJa
          ? "これはデモ用のキュー項目の文字起こし結果です。SPARQLエンドポイントとTogoMCPサーバーの連携テストを録音したものです。"
          : "This is a demo queue item's transcript. It's a short recording testing the SPARQL endpoint and the TogoMCP server integration.";
        return {
          text,
          rendered: text,
          language: req.language,
          duration: 42.0,
          id: 9999,
        };
      }

      case "list_history": {
        return dataset().history;
      }

      case "search_history": {
        const query = String(args.query || "").trim();
        const terms = query.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
        const { history, notes } = dataset();
        if (terms.length === 0) return [];
        const results = [];
        for (const item of history) {
          const title = (item.title || basename(item.sourceFileName)).toLowerCase();
          const body = (item.transcriptText || "").toLowerCase();
          const itemNotes = notes[item.id] || [];
          const matchedNotes = [];
          const termMatches = (term) => {
            if (title.includes(term) || body.includes(term)) return true;
            for (const n of itemNotes) {
              if (n.quotedText.toLowerCase().includes(term) || n.note.toLowerCase().includes(term)) {
                return true;
              }
            }
            return false;
          };
          const allMatch = terms.every(termMatches);
          if (!allMatch) continue;
          for (const n of itemNotes) {
            const noteText = (n.quotedText + " " + n.note).toLowerCase();
            if (terms.some((term) => noteText.includes(term))) {
              matchedNotes.push({ quotedText: n.quotedText, note: n.note });
            }
          }
          results.push({
            id: item.id,
            sourceFileName: item.sourceFileName,
            startedAt: item.startedAt,
            transcriptText: item.transcriptText,
            title: item.title,
            matchedNotes,
          });
        }
        await delay(150);
        return results;
      }

      case "trash_audio":
        return { trashed: true };

      case "delete_history_entry":
        return { trashed: true };

      case "update_history_title": {
        const ds = dataset();
        const row = ds.history.find((h) => h.id === args.id);
        const title = args.title && args.title.trim() ? args.title.trim() : null;
        if (row) row.title = title;
        return { id: args.id, title };
      }

      case "export_transcript":
        return null;

      case "save_api_key":
        return null;
      case "get_api_key_status":
        return true;
      case "save_database_url":
        return null;
      case "get_database_url_status":
        return true;
      case "test_database_connection":
        await delay(600);
        return { connected: true };

      case "set_menu_language":
        return null;

      case "list_dictionary":
        return dataset().dictionary;

      case "add_dictionary_entry": {
        const ds = dataset();
        const req = args.request || {};
        const now = new Date().toISOString();
        const row = { id: state.nextDictionaryId++, word: req.word, replacement: req.replacement, createdAt: now, updatedAt: now };
        ds.dictionary.unshift(row);
        return row;
      }

      case "update_dictionary_entry": {
        const ds = dataset();
        const req = args.request || {};
        const row = ds.dictionary.find((d) => d.id === req.id);
        if (row) {
          row.word = req.word;
          row.replacement = req.replacement;
          row.updatedAt = new Date().toISOString();
        }
        return row;
      }

      case "delete_dictionary_entry": {
        const ds = dataset();
        ds.dictionary = ds.dictionary.filter((d) => d.id !== args.id);
        return null;
      }

      case "import_dictionary_file":
        return null;

      case "list_notes": {
        const ds = dataset();
        return ds.notes[args.transcriptionId] || [];
      }

      case "add_note": {
        const ds = dataset();
        const req = args.request || {};
        const now = new Date().toISOString();
        const row = {
          id: state.nextNoteId++,
          transcriptionId: req.transcriptionId,
          startOffset: req.startOffset,
          endOffset: req.endOffset,
          quotedText: req.quotedText,
          note: req.note,
          createdAt: now,
          updatedAt: now,
        };
        if (!ds.notes[req.transcriptionId]) ds.notes[req.transcriptionId] = [];
        ds.notes[req.transcriptionId].push(row);
        await delay(150);
        return row;
      }

      case "update_note": {
        const ds = dataset();
        const req = args.request || {};
        for (const list of Object.values(ds.notes)) {
          const row = list.find((n) => n.id === req.id);
          if (row) {
            row.note = req.note;
            row.updatedAt = new Date().toISOString();
            return row;
          }
        }
        throw new Error("Note not found");
      }

      case "delete_note": {
        const ds = dataset();
        for (const key of Object.keys(ds.notes)) {
          ds.notes[key] = ds.notes[key].filter((n) => n.id !== args.id);
        }
        return null;
      }

      case "list_input_devices":
        return [
          { id: "default-mic", name: window.localStorage.getItem("voice-transcript-lang") === "ja" ? "内蔵マイクロフォン" : "Built-in Microphone" },
          { id: "usb-mic-1", name: "USB Condenser Mic" },
        ];

      case "list_output_devices":
        return [
          { id: "default-out", name: window.localStorage.getItem("voice-transcript-lang") === "ja" ? "内蔵スピーカー" : "Built-in Speakers" },
        ];

      case "start_recording":
        return null;

      case "set_recording_source":
        return null;

      case "stop_recording":
        return { path: "/Users/demo/recordings/recording-" + Date.now() + ".wav", durationSeconds: 12, silentSources: [] };

      // -------------------- plugin:dialog --------------------
      case "plugin:dialog|open": {
        // pickFiles(): simulate the user picking a different demo file
        // (or pair of files) each time "Add files" is clicked, so the
        // capture script can build up a queue with a realistic mix of
        // states across a couple of clicks.
        const seq = DIALOG_OPEN_SEQUENCE[Math.min(state.dialogOpenCallCount, DIALOG_OPEN_SEQUENCE.length - 1)];
        state.dialogOpenCallCount++;
        return seq;
      }

      case "plugin:dialog|save":
        return "/Users/demo/exports/transcript.txt";

      case "plugin:dialog|message":
        // confirm()/ask() compare the resolved value against okLabel --
        // always "agree" so a demo flow never gets stuck on a native
        // dialog that can't actually appear in a browser-driven mock.
        return (args.buttons && args.buttons.OkCustom) || "Ok";

      // -------------------- plugin:clipboard-manager --------------------
      case "plugin:clipboard-manager|write_text":
        return null;

      // -------------------- plugin:event --------------------
      case "plugin:event|listen": {
        const id = nextEventListenerId++;
        if (!eventListeners.has(args.event)) eventListeners.set(args.event, new Set());
        eventListeners.get(args.event).add(args.handler);
        return id;
      }

      case "plugin:event|unlisten": {
        for (const set of eventListeners.values()) set.delete(args.eventId);
        return null;
      }

      case "plugin:event|emit":
      case "plugin:event|emit_to": {
        window.__mockEmit(args.event, args.payload);
        return null;
      }

      default:
        console.warn("[mock-tauri] unhandled invoke:", cmd, args);
        return null;
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke: function (cmd, args) {
      return mockInvoke(cmd, args);
    },
    transformCallback: transformCallback,
    unregisterCallback: unregisterCallback,
    convertFileSrc: function (filePath) {
      return filePath;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };

  // Some plugin/event code paths probe this global directly (see
  // @tauri-apps/api/event's _unlisten) -- present but unused by our mock
  // invoke-based unlisten path above.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function (event, eventId) {
      const set = eventListeners.get(event);
      if (set) set.delete(eventId);
    },
  };

  window.__TAURI_METADATA__ = {
    __windows: [{ label: "main" }],
    __currentWindow: { label: "main" },
  };
})();
