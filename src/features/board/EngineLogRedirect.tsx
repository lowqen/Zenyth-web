import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { showEngineLog } from "./inspectorPane";

/**
 * 옛 `/engine` 주소 — 엔진 탭은 보드의 «로그» 칸이 됐다(라이브러리 계획 U2). 즐겨찾기 · 오래 열어 둔 탭 · 문서의
 * 링크가 빈 화면이나 보드 개요로 떨어지지 않게, 칸을 «로그»로 돌려놓고 보드로 넘긴다(기록에 남기지 않는다).
 */
export function EngineLogRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    showEngineLog();
    void navigate("/board", { replace: true });
  }, [navigate]);
  return null;
}
