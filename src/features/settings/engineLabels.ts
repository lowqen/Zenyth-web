import type { EnginePreference, EngineVariant, NativeBuild } from "../../engine/engine-client";
import { localized, msg } from "../../i18n/i18n";

export const VARIANT_LABEL: Readonly<Record<EngineVariant, string>> = localized({
  "multi-simd128-relaxed": msg("멀티스레드 · relaxed SIMD"),
  "multi-simd128": msg("멀티스레드"),
  "single-simd128-relaxed": msg("단일 스레드 · relaxed SIMD"),
  "single-simd128": msg("단일 스레드"),
  native: msg("네이티브 Rapfi"),
  remote: msg("원격 서버 Rapfi"),
});

/** 드롭다운 항목 이름(설정). 사전 열쇠라 그릴 때 `t()`. */
export const PREFERENCE_LABEL: Record<EnginePreference, string> = {
  auto: msg("자동 (가장 빠른 것)"),
  multi: "Multi-thread (pthread)",
  relaxed: msg("WASM Relaxed SIMD (단일 스레드)"),
  simd: msg("WASM Standard SIMD (단일 스레드)"),
  native: msg("네이티브 Rapfi · 자동 (이 CPU 최적)"),
  "native-avx512vnni": "Rapfi AVX-512 VNNI",
  "native-avx512": "Rapfi AVX-512",
  "native-avxvnni": "Rapfi AVX-VNNI",
  "native-avx2": "Rapfi AVX2",
  "native-sse": "Rapfi SSE",
  remote: msg("원격 서버 (TCP)"),
};

/** 동봉 빌드의 짧은 이름 — 고유명이라 옮기지 않는다. */
export const BUILD_LABEL: Readonly<Record<NativeBuild, string>> = {
  avx512vnni: "AVX-512 VNNI",
  avx512: "AVX-512",
  avxvnni: "AVX-VNNI",
  avx2: "AVX2",
  sse: "SSE",
};
