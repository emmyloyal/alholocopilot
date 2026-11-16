"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const VOICE_LANGS: { code: string; label: string }[] = [
  { code: "auto", label: "Auto (browser language)" },
  { code: "en-US", label: "English" }, { code: "es-ES", label: "Español" }, { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" }, { code: "pt-BR", label: "Português" }, { code: "it-IT", label: "Italiano" },
  { code: "nl-NL", label: "Nederlands" }, { code: "tr-TR", label: "Türkçe" }, { code: "ru-RU", label: "Русский" },
  { code: "zh-CN", label: "中文" }, { code: "ja-JP", label: "日本語" }, { code: "ko-KR", label: "한국어" },
  { code: "ar-SA", label: "العربية" }, { code: "hi-IN", label: "हिन्दी" },
];

const BCP: Record<string, string> = Object.fromEntries(VOICE_LANGS.filter((l) => l.code !== "auto").map((l) => [l.code.slice(0, 2), l.code]));

export function speak(text: string, lang: string) {
  try {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP[lang] ?? lang;
    window.speechSynthesis.speak(u);
  } catch {}
}

/** Browser speech-to-text (Web Speech API). Chrome/Edge/Safari; Firefox has no support. */
export function useVoice(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<any>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const start = useCallback((lang: string) => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    setError(""); setInterim("");
    const rec = new SR();
    rec.lang = lang === "auto" ? navigator.language || "en-US" : lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let finalText = "", partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else partial += r[0].transcript;
      }
      setInterim(partial);
      if (finalText.trim()) cb.current(finalText.trim());
    };
    rec.onerror = (e: any) => setError(e.error === "not-allowed" ? "Microphone permission denied" : e.error === "no-speech" ? "Didn't hear anything" : `Voice error: ${e.error}`);
    rec.onend = () => { setListening(false); setInterim(""); };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }, []);

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch {} setListening(false); }, []);
  return { supported, listening, interim, error, start, stop };
}
