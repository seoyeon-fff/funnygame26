"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Trophy,
  RotateCcw,
  Play,
  Pause,
  Sparkles,
  AlertTriangle,
  ArrowLeft,
  User,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  ThumbsUp,
} from "lucide-react";

// 블록 색상 타입 정의 (연한 빨강, 연한 주황, 연한 노랑, 연한 파랑, 연한 녹색, 연한 보라)
interface BrickColorDef {
  id: string;
  name: string;
  fill: string;
  border: string;
  glow: string;
  isTargetRed?: boolean;
}

const BRICK_COLORS: BrickColorDef[] = [
  { id: "light-red", name: "연한 빨강", fill: "#fca5a5", border: "#f87171", glow: "rgba(248, 113, 113, 0.4)", isTargetRed: true },
  { id: "light-orange", name: "연한 주황", fill: "#fed7aa", border: "#fb923c", glow: "rgba(251, 146, 60, 0.4)" },
  { id: "light-yellow", name: "연한 노랑", fill: "#fef08a", border: "#facc15", glow: "rgba(250, 204, 21, 0.4)" },
  { id: "light-green", name: "연한 녹색", fill: "#bbf7d0", border: "#4ade80", glow: "rgba(74, 222, 128, 0.4)" },
  { id: "light-blue", name: "연한 파랑", fill: "#bfdbfe", border: "#60a5fa", glow: "rgba(96, 165, 250, 0.4)" },
  { id: "light-purple", name: "연한 보라", fill: "#e9d5ff", border: "#c084fc", glow: "rgba(192, 132, 252, 0.4)" },
];

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  color: BrickColorDef;
  alive: boolean;
}

const CANVAS_WIDTH = 840;
const CANVAS_HEIGHT = 560;
const BRICK_ROWS = 5;
const BRICK_COLS = 8;
const REQUIRED_RED_COUNT = 3;
const CONSTANT_BALL_SPEED = 6.8; // 사용자 요청: 공 속도 정확히 6.8로 설정

export default function BrickBreakerGame() {
  // 테마 (라이트/다크)
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // 화면 전환 (lobby / game)
  const [screen, setScreen] = useState<"lobby" | "game">("lobby");
  const [userName, setUserName] = useState("");
  const [inputError, setInputError] = useState("");

  // 게임 상태 (ready: 카운트다운 전/중, playing: 플레이 중, paused: 일시정지, cleared: 승리, failed: 실패)
  const [gameStatus, setGameStatus] = useState<"ready" | "playing" | "paused" | "cleared" | "failed">("ready");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [lives, setLives] = useState(3);
  const [redClearedCount, setRedClearedCount] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [finalClearedTime, setFinalClearedTime] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [showThumbsUp, setShowThumbsUp] = useState(false);
  const [isSavingToSheet, setIsSavingToSheet] = useState(false);
  const [saveSheetSuccess, setSaveSheetSuccess] = useState<boolean | null>(null);
  const [topRankings, setTopRankings] = useState<Array<{ name: string; finishtime: string }>>([]);
  const [isLoadingRankings, setIsLoadingRankings] = useState(false);
  const thumbsUpTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 분:초 포맷팅 함수 (mm:ss)
  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  // BGM 오디오 참조
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // requestAnimationFrame 내부에서 참조할 동기 상태 변수
  const gameStateRef = useRef({
    paddleX: (CANVAS_WIDTH - 110) / 2,
    paddleWidth: 110,
    paddleHeight: 14,
    paddleSpeed: 8,
    ballX: CANVAS_WIDTH / 2,
    ballY: CANVAS_HEIGHT - 45,
    ballRadius: 8,
    ballSpeedX: 4.2,
    ballSpeedY: -4.5,
    ballInPlay: false,
    keys: { left: false, right: false },
    bricks: [] as Brick[],
    lives: 3,
    redCleared: 0,
    startTime: 0,
    pausedAccumulated: 0,
    pauseStartTime: 0,
    status: "ready" as "ready" | "playing" | "paused" | "cleared" | "failed",
  });

  // 연한 빨강 블록 제거 시 따봉 1초간 띄우기 함수
  const triggerThumbsUp = useCallback(() => {
    if (thumbsUpTimerRef.current) {
      clearTimeout(thumbsUpTimerRef.current);
    }
    setShowThumbsUp(true);
    thumbsUpTimerRef.current = setTimeout(() => {
      setShowThumbsUp(false);
    }, 1000);
  }, []);

  // 상위 3명 랭킹 가져오기 함수 (구글 시트 gviz 공개 API 및 Apps Script 다중 fallback 지원)
  const fetchTopRankings = useCallback(async () => {
    setIsLoadingRankings(true);
    const SPREADSHEET_ID = "1pSSAvuf6BEz6YvfSIF93vqkcG9JrAhz_-zbkBpTAqOw";
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;

    // 분:초 문자열을 초(sec)로 환산
    const parseTimeToSec = (str: string): number => {
      if (!str) return 999999;
      const parts = str.trim().split(":");
      if (parts.length === 2) {
        return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
      }
      const num = parseInt(str, 10);
      return isNaN(num) ? 999999 : num;
    };

    try {
      // 1순위: 구글 스프레드시트 공식 gviz 쿼리 API (배포 버전과 무관하게 실시간 100% 최신 행 조회)
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`;
      const res = await fetch(gvizUrl);
      if (res.ok) {
        const text = await res.text();
        const jsonStart = text.indexOf("{");
        const jsonEnd = text.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const json = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
          const rows = json.table?.rows || [];
          const records: Array<{ name: string; finishtime: string; seconds: number }> = [];

          rows.forEach((row: { c?: Array<{ v?: string | number | null; f?: string | null } | null> }) => {
            if (!row.c) return;
            const nameCell = row.c[1];
            const timeCell = row.c[2];

            const name = nameCell?.v ? String(nameCell.v).trim() : "";
            // formatted value(f)가 있으면 우선 사용, 없으면 v 사용
            let timeStr = timeCell?.f ? String(timeCell.f).trim() : (timeCell?.v ? String(timeCell.v).trim() : "");
            
            // "0:07" 형태를 "00:07" 형식으로 깔끔하게 통일
            if (timeStr.includes(":")) {
              const [m, s] = timeStr.split(":");
              timeStr = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            }

            if (name && timeStr) {
              records.push({
                name,
                finishtime: timeStr,
                seconds: parseTimeToSec(timeStr),
              });
            }
          });

          // 종료시간 오름차순(가장 빠른 시간 우선) 정렬
          records.sort((a, b) => a.seconds - b.seconds);
          const top3 = records.slice(0, 3).map((r) => ({
            name: r.name,
            finishtime: r.finishtime,
          }));

          if (top3.length > 0) {
            setTopRankings(top3);
            setIsLoadingRankings(false);
            return;
          }
        }
      }

      // 2순위 Fallback: Google Apps Script Web App
      if (scriptUrl) {
        const appScriptRes = await fetch(`${scriptUrl}?action=ranking&t=${Date.now()}`);
        if (appScriptRes.ok) {
          const data = await appScriptRes.json();
          if (data.ranking && Array.isArray(data.ranking) && data.ranking.length > 0) {
            setTopRankings(data.ranking);
          }
        }
      }
    } catch (err) {
      console.error("랭킹 조회 오류:", err);
    } finally {
      setIsLoadingRankings(false);
    }
  }, []);

  // 구글 시트 저장 함수 (미션 성공 시에만 호출됨, 중단/실패 시 호출하지 않음)
  const saveGameResultToSheet = useCallback(async (finishtimeFormatted: string) => {
    // .env.local의 NEXT_PUBLIC_GOOGLE_SCRIPT_URL 키 값 참조
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
    if (!scriptUrl) {
      console.warn("NEXT_PUBLIC_GOOGLE_SCRIPT_URL 환경변수가 설정되지 않았습니다.");
      return;
    }

    setIsSavingToSheet(true);
    try {
      const now = new Date();
      // KST 한국 시간 기준 timestamp 문자열 생성 (YYYY-MM-DD HH:mm:ss)
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");
      const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      
      const payload = {
        timestamp,
        name: userName.trim() || "익명",
        finishtime: finishtimeFormatted,
      };

      // Google Apps Script에 POST 전송
      await fetch(scriptUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      setSaveSheetSuccess(true);

      // 데이터 저장 후 구글 시트의 최신 상위 3명 순위 조회
      setTimeout(() => {
        fetchTopRankings();
      }, 700);
    } catch (err) {
      console.error("구글 시트 저장 오류:", err);
      setSaveSheetSuccess(false);
    } finally {
      setIsSavingToSheet(false);
    }
  }, [userName, fetchTopRankings]);

  // 시스템 테마 감지 및 초기화
  useEffect(() => {
    const savedTheme = localStorage.getItem("inu_game_theme") as "light" | "dark" | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle("dark", savedTheme === "dark");
    } else {
      setTheme("light");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("inu_game_theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  // Web Audio 충돌 및 효과음 (AudioContext 재사용으로 브라우저 GC 렉 완전 제거)
  const playSound = useCallback((type: "paddle" | "brick" | "red" | "fail" | "win" | "loseLife" | "beep" | "go") => {
    if (isMuted) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          audioCtxRef.current = new AudioCtx();
        }
      }
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      if (type === "paddle") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(540, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === "brick") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(500, ctx.currentTime);
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.09);
        osc.start();
        osc.stop(ctx.currentTime + 0.09);
      } else if (type === "red") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(659, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(987, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === "beep") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === "go") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.35, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else if (type === "loseLife") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(260, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(130, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } else if (type === "win") {
        [523, 659, 784, 1046, 1318].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "triangle";
          osc.frequency.setValueAtTime(f, ctx.currentTime + idx * 0.1);
          gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.1);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + idx * 0.1 + 0.2);
          osc.start(ctx.currentTime + idx * 0.1);
          osc.stop(ctx.currentTime + idx * 0.1 + 0.2);
        });
      } else if (type === "fail") {
        [280, 230, 190, 150].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(f, ctx.currentTime + idx * 0.12);
          gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.12);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + idx * 0.12 + 0.18);
          osc.start(ctx.currentTime + idx * 0.12);
          osc.stop(ctx.currentTime + idx * 0.12 + 0.18);
        });
      }
    } catch {
      // AudioContext 제한 무시
    }
  }, [isMuted]);

  // BGM 볼륨 및 재생 제어
  const startBGM = useCallback(() => {
    if (!bgmRef.current) {
      const audio = new Audio("/Hyper_Speed_Run.mp3");
      audio.loop = true;
      audio.volume = 0.22; // 볼륨이 너무 크지 않도록 설정 (0.22)
      bgmRef.current = audio;
    }
    bgmRef.current.volume = isMuted ? 0 : 0.22;
    bgmRef.current.play().catch(() => {
      // 자동 재생 정책 허용 대기
    });
  }, [isMuted]);

  const stopBGM = useCallback(() => {
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.currentTime = 0;
    }
  }, []);

  const pauseBGM = useCallback(() => {
    if (bgmRef.current) {
      bgmRef.current.pause();
    }
  }, []);

  const resumeBGM = useCallback(() => {
    if (bgmRef.current && !isMuted) {
      bgmRef.current.play().catch(() => {});
    }
  }, [isMuted]);

  // 음소거 토글
  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (bgmRef.current) {
        bgmRef.current.volume = next ? 0 : 0.22;
      }
      return next;
    });
  };

  // 벽돌 초기화 함수: 5행 × 8열 = 40개 중 정확히 30%(12개)를 연한 빨강으로 배치
  const createBricks = useCallback(() => {
    const bricks: Brick[] = [];
    const brickWidth = 92;
    const brickHeight = 26;
    const padding = 9;
    const offsetTop = 45;
    const offsetLeft = (CANVAS_WIDTH - (BRICK_COLS * brickWidth + (BRICK_COLS - 1) * padding)) / 2;

    const totalCount = BRICK_ROWS * BRICK_COLS; // 40개
    const redCount = Math.round(totalCount * 0.3); // 30% -> 정확히 12개

    // 40개의 인덱스 중 12개를 무작위 추출하여 빨간 블록 지정
    const redIndices = new Set<number>();
    while (redIndices.size < redCount) {
      const rand = Math.floor(Math.random() * totalCount);
      redIndices.add(rand);
    }

    const otherColors = BRICK_COLORS.filter((c) => !c.isTargetRed);

    let idx = 0;
    for (let r = 0; r < BRICK_ROWS; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        const x = offsetLeft + c * (brickWidth + padding);
        const y = offsetTop + r * (brickHeight + padding);

        let color: BrickColorDef;
        if (redIndices.has(idx)) {
          color = BRICK_COLORS[0]; // 연한 빨강
        } else {
          const randColorIdx = Math.floor(Math.random() * otherColors.length);
          color = otherColors[randColorIdx];
        }

        bricks.push({
          x,
          y,
          width: brickWidth,
          height: brickHeight,
          color,
          alive: true,
        });
        idx++;
      }
    }

    return bricks;
  }, []);

  // 게임 카운트다운(3, 2, 1, START) 및 시작 (TTS 음성 없이 경쾌한 비프 효과음만 사용)
  const startCountdownAndPlay = useCallback(() => {
    const g = gameStateRef.current;
    g.status = "ready";
    g.ballInPlay = false;
    setGameStatus("ready");
    setCountdown(3);
    playSound("beep");

    const steps = [
      { count: 2, sound: "beep" as const, delay: 1000 },
      { count: 1, sound: "beep" as const, delay: 2000 },
      { count: 0, sound: "go" as const, delay: 3000 },
    ];

    steps.forEach(({ count, sound, delay }) => {
      setTimeout(() => {
        setCountdown(count);
        playSound(sound);
      }, delay);
    });

    // START 이후 1초 뒤 게임 본격 시작
    setTimeout(() => {
      setCountdown(null);
      g.status = "playing";
      g.ballInPlay = true;
      g.startTime = Date.now();
      g.pausedAccumulated = 0;
      setGameStatus("playing");
      startBGM();
    }, 4000);
  }, [playSound, startBGM]);

  // 게임 초기화
  const initializeGame = useCallback(() => {
    const initialBricks = createBricks();
    const g = gameStateRef.current;
    g.paddleX = (CANVAS_WIDTH - 110) / 2;
    g.ballX = CANVAS_WIDTH / 2;
    g.ballY = CANVAS_HEIGHT - 45;
    const initialAngle = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * 0.2);
    g.ballSpeedX = CONSTANT_BALL_SPEED * Math.sin(initialAngle);
    g.ballSpeedY = -CONSTANT_BALL_SPEED * Math.cos(initialAngle);
    g.ballInPlay = false;
    g.bricks = initialBricks;
    g.lives = 3;
    g.redCleared = 0;
    g.startTime = 0;
    g.pausedAccumulated = 0;
    g.pauseStartTime = 0;

    setLives(3);
    setRedClearedCount(0);
    setElapsedTime(0);
    setFinalClearedTime("");
    setShowThumbsUp(false);
    setIsSavingToSheet(false);
    setSaveSheetSuccess(null);
    setTopRankings([]);
    setIsLoadingRankings(false);

    startCountdownAndPlay();
  }, [createBricks, startCountdownAndPlay]);

  // 로비에서 게임 시작 버튼 클릭
  const handleStartLobby = () => {
    if (!userName.trim()) {
      setInputError("사용자 이름을 입력해주세요!");
      return;
    }
    setInputError("");
    setScreen("game");
    setTimeout(() => {
      initializeGame();
    }, 150);
  };

  // 게임 중 일시정지 / 재개 버튼 토글
  const togglePause = () => {
    const g = gameStateRef.current;
    if (gameStatus === "playing") {
      g.status = "paused";
      g.pauseStartTime = Date.now();
      setGameStatus("paused");
      pauseBGM();
    } else if (gameStatus === "paused") {
      if (g.pauseStartTime > 0) {
        g.pausedAccumulated += Date.now() - g.pauseStartTime;
        g.pauseStartTime = 0;
      }
      g.status = "playing";
      setGameStatus("playing");
      resumeBGM();
    }
  };

  // 다시 시작 버튼 클릭 (요구사항: "다시 시작 버튼을 클릭하면 이름을 작성하는 화면으로 이동")
  const handleRestartToLobby = () => {
    stopBGM();
    setGameStatus("ready");
    setCountdown(null);
    setScreen("lobby");
  };

  // 같은 이름으로 바로 재도전
  const handleRetryCurrentGame = () => {
    stopBGM();
    initializeGame();
  };

  // 키보드 방향키 조작 (PC 버전: 좌우 방향키로만 부드럽게 이동)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        gameStateRef.current.keys.left = true;
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        gameStateRef.current.keys.right = true;
        e.preventDefault();
      } else if (e.key === "p" || e.key === "P" || e.key === " ") {
        // 단축키로도 일시정지 지원 (게임 중일 때)
        if (screen === "game" && (gameStateRef.current.status === "playing" || gameStateRef.current.status === "paused")) {
          togglePause();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        gameStateRef.current.keys.left = false;
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        gameStateRef.current.keys.right = false;
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [screen, gameStatus]);

  // 모바일 터치 및 터치 슬라이드 조작 핸들러
  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (gameStateRef.current.status !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const scaleX = CANVAS_WIDTH / rect.width;
    const clientX = (touch.clientX - rect.left) * scaleX;
    const g = gameStateRef.current;
    g.paddleX = Math.max(10, Math.min(CANVAS_WIDTH - g.paddleWidth - 10, clientX - g.paddleWidth / 2));
  };

  // 모바일 터치 버튼용
  const handleTouchButton = (direction: "left" | "right", isDown: boolean) => {
    if (direction === "left") {
      gameStateRef.current.keys.left = isDown;
    } else {
      gameStateRef.current.keys.right = isDown;
    }
  };

  // 게임 루프 (requestAnimationFrame)
  useEffect(() => {
    if (screen !== "game") return;

    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false }); // alpha 비활성화로 GPU 하드웨어 가속 극대화
    if (!ctx) return;

    let lastSecUpdate = 0;

    const gameLoop = () => {
      const g = gameStateRef.current;

      // 1. 상태 업데이트
      if (g.status === "playing") {
        // 타이머 업데이트 (1초마다만 React setState 트리거 -> 불필요한 전체 렌더링 렉 원천 차단)
        const now = Date.now();
        const activeDuration = Math.max(0, Math.floor((now - g.startTime - g.pausedAccumulated) / 1000));
        if (activeDuration !== lastSecUpdate) {
          lastSecUpdate = activeDuration;
          setElapsedTime(activeDuration);
        }

        // 패들 이동 (방향키)
        if (g.keys.left) {
          g.paddleX = Math.max(10, g.paddleX - g.paddleSpeed);
        }
        if (g.keys.right) {
          g.paddleX = Math.min(CANVAS_WIDTH - g.paddleWidth - 10, g.paddleX + g.paddleSpeed);
        }

        // 공 이동
        if (g.ballInPlay) {
          g.ballX += g.ballSpeedX;
          g.ballY += g.ballSpeedY;

          // 좌우 벽 충돌
          if (g.ballX - g.ballRadius <= 0) {
            g.ballX = g.ballRadius;
            g.ballSpeedX = Math.abs(g.ballSpeedX);
            playSound("paddle");
          } else if (g.ballX + g.ballRadius >= CANVAS_WIDTH) {
            g.ballX = CANVAS_WIDTH - g.ballRadius;
            g.ballSpeedX = -Math.abs(g.ballSpeedX);
            playSound("paddle");
          }

          // 천장 충돌
          if (g.ballY - g.ballRadius <= 0) {
            g.ballY = g.ballRadius;
            g.ballSpeedY = Math.abs(g.ballSpeedY);
            playSound("paddle");
          }

          // 패들 충돌
          const paddleTop = CANVAS_HEIGHT - 32;
          const paddleBottom = paddleTop + g.paddleHeight;
          if (
            g.ballY + g.ballRadius >= paddleTop &&
            g.ballY - g.ballRadius <= paddleBottom &&
            g.ballX >= g.paddleX - 4 &&
            g.ballX <= g.paddleX + g.paddleWidth + 4 &&
            g.ballSpeedY > 0
          ) {
            const hitOffset = (g.ballX - (g.paddleX + g.paddleWidth / 2)) / (g.paddleWidth / 2);
            const clampedOffset = Math.max(-0.92, Math.min(0.92, hitOffset));
            const maxAngle = Math.PI * 0.40;
            const angle = clampedOffset * maxAngle;

            g.ballSpeedX = CONSTANT_BALL_SPEED * Math.sin(angle);
            g.ballSpeedY = -CONSTANT_BALL_SPEED * Math.cos(angle);
            g.ballY = paddleTop - g.ballRadius;
            playSound("paddle");
          }

          // 벽돌 충돌 검사
          for (const brick of g.bricks) {
            if (!brick.alive) continue;

            if (
              g.ballX + g.ballRadius > brick.x &&
              g.ballX - g.ballRadius < brick.x + brick.width &&
              g.ballY + g.ballRadius > brick.y &&
              g.ballY - g.ballRadius < brick.y + brick.height
            ) {
              brick.alive = false;

              const prevBallX = g.ballX - g.ballSpeedX;
              const prevBallY = g.ballY - g.ballSpeedY;

              if (prevBallX <= brick.x || prevBallX >= brick.x + brick.width) {
                g.ballSpeedX = -g.ballSpeedX;
              } else {
                g.ballSpeedY = -g.ballSpeedY;
              }

              const currentLen = Math.hypot(g.ballSpeedX, g.ballSpeedY) || 1;
              g.ballSpeedX = (g.ballSpeedX / currentLen) * CONSTANT_BALL_SPEED;
              g.ballSpeedY = (g.ballSpeedY / currentLen) * CONSTANT_BALL_SPEED;

              if (brick.color.isTargetRed) {
                g.redCleared += 1;
                setRedClearedCount(g.redCleared);
                playSound("red");

                if (g.redCleared < REQUIRED_RED_COUNT) {
                  triggerThumbsUp();
                } else {
                  setShowThumbsUp(false);
                }

                if (g.redCleared >= REQUIRED_RED_COUNT) {
                  g.status = "cleared";
                  setGameStatus("cleared");
                  stopBGM();
                  playSound("win");

                  const finalSec = Math.max(0, Math.floor((Date.now() - g.startTime - g.pausedAccumulated) / 1000));
                  const formattedTime = formatTime(finalSec);
                  setFinalClearedTime(formattedTime);

                  saveGameResultToSheet(formattedTime);

                  const duration = 2.5 * 1000;
                  const end = Date.now() + duration;

                  const frame = () => {
                    confetti({
                      particleCount: 4,
                      angle: 60,
                      spread: 55,
                      origin: { x: 0 },
                    });
                    confetti({
                      particleCount: 4,
                      angle: 120,
                      spread: 55,
                      origin: { x: 1 },
                    });
                    if (Date.now() < end) {
                      requestAnimationFrame(frame);
                    }
                  };
                  frame();
                  break;
                }
              } else {
                playSound("brick");
              }

              break;
            }
          }

          // 바닥 추락 (공 놓침)
          if (g.ballY - g.ballRadius > CANVAS_HEIGHT) {
            g.lives -= 1;
            setLives(g.lives);

            if (g.lives <= 0) {
              g.status = "failed";
              setGameStatus("failed");
              stopBGM();
              playSound("fail");
            } else {
              playSound("loseLife");
              g.ballInPlay = true;
              g.ballX = g.paddleX + g.paddleWidth / 2;
              g.ballY = CANVAS_HEIGHT - 45;
              const reAngle = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4);
              g.ballSpeedX = CONSTANT_BALL_SPEED * Math.sin(reAngle);
              g.ballSpeedY = -CONSTANT_BALL_SPEED * Math.cos(reAngle);
            }
          }
        }
      }

      // 2. 렌더링 최적화
      const isDark = theme === "dark";
      ctx.fillStyle = isDark ? "#0f172a" : "#f8fafc";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // 은은한 격자선 (가벼운 단일 stroke 일괄 렌더링)
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 30; x < CANVAS_WIDTH; x += 30) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
      }
      for (let y = 30; y < CANVAS_HEIGHT; y += 30) {
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
      }
      ctx.stroke();

      // 벽돌 렌더링 (과도한 blur 섀도우를 제거하여 60/120fps 부드러움 극대화)
      for (const b of g.bricks) {
        if (!b.alive) continue;

        ctx.fillStyle = b.color.fill;
        ctx.strokeStyle = b.color.border;
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.width, b.height, 4);
        ctx.fill();
        ctx.stroke();

        // 3D 입체 광택 하이라이트
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.beginPath();
        ctx.roundRect(b.x + 2, b.y + 2, b.width - 4, b.height / 3, 2);
        ctx.fill();

        // 연한 빨강 벽돌 별표 타겟 마크
        if (b.color.isTargetRed) {
          ctx.fillStyle = "#dc2626";
          ctx.font = "bold 12px Pretendard, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("★", b.x + b.width / 2, b.y + b.height / 2 + 1);
        }
      }

      // 패들 렌더링
      const paddleY = CANVAS_HEIGHT - 32;
      ctx.fillStyle = "#2563eb";
      ctx.strokeStyle = "#93c5fd";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(g.paddleX, paddleY, g.paddleWidth, g.paddleHeight, 6);
      ctx.fill();
      ctx.stroke();

      // 공 렌더링
      if (g.status === "playing" || g.status === "ready" || g.status === "paused") {
        ctx.fillStyle = "#f59e0b";
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(g.ballX, g.ballY, g.ballRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      animId = requestAnimationFrame(gameLoop);
    };

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [screen, theme, playSound, stopBGM, triggerThumbsUp, saveGameResultToSheet]);

  return (
    <div className={`min-h-screen transition-colors duration-300 flex flex-col justify-between select-none ${
      theme === "dark"
        ? "bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white"
        : "bg-gradient-to-br from-blue-50/70 via-indigo-50/50 to-sky-50 text-slate-800"
    }`}>
      {/* 1. 상단 글로벌 네비게이션 헤더 */}
      <header className={`w-full border-b backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between transition-colors ${
        theme === "dark" ? "bg-slate-900/80 border-slate-800 text-white" : "bg-white/80 border-slate-200 text-slate-800 shadow-xs"
      }`}>
        <div className="flex items-center gap-2.5">
          <span className="text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 bg-clip-text text-transparent">
            INU 벽돌깨기
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 음소거 버튼 */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleMute}
            className={`h-9 px-3 text-xs font-semibold rounded-lg cursor-pointer ${
              theme === "dark" ? "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200" : "bg-white border-slate-200 hover:bg-slate-100 text-slate-700"
            }`}
            title={isMuted ? "소리 켜기" : "음소거"}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-emerald-500" />}
            <span className="hidden sm:inline ml-1.5">{isMuted ? "음소거" : "BGM ON"}</span>
          </Button>

          {/* 라이트/다크 모드 토글 버튼 (요구사항: 라이트/다크모드 변경 기능 추가) */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleTheme}
            className={`h-9 px-3 text-xs font-semibold rounded-lg cursor-pointer ${
              theme === "dark" ? "bg-slate-800 border-slate-700 hover:bg-slate-700 text-amber-300" : "bg-white border-slate-200 hover:bg-slate-100 text-slate-700"
            }`}
            title="테마 변경"
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="hidden sm:inline ml-1.5 text-slate-200">라이트 모드</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-indigo-600 fill-indigo-600" />
                <span className="hidden sm:inline ml-1.5 text-slate-700">다크 모드</span>
              </>
            )}
          </Button>
        </div>
      </header>

      {/* 2. 메인 컨텐츠 영역 */}
      <main className="flex-1 flex flex-col items-center justify-center p-3 sm:p-6 w-full max-w-6xl mx-auto">
        {screen === "lobby" ? (
          /* =================== 로비 화면 (이름 입력 & 횃불이) =================== */
          <Card className={`w-full max-w-lg border shadow-xl backdrop-blur-md overflow-hidden transition-all duration-300 ${
            theme === "dark"
              ? "bg-slate-900/90 border-slate-800 text-white"
              : "bg-white/95 border-slate-200 text-slate-800 shadow-slate-200/50"
          }`}>
            <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 py-6 px-6 text-center text-white">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-wide drop-shadow-sm">
                INU 벽돌깨기
              </h1>
              <p className="text-blue-100 text-xs sm:text-sm mt-1 font-medium">
                인천대학교 마스코트 횃불이와 함께하는 벽돌깨기 게임
              </p>
            </div>

            <CardContent className="p-6 sm:p-8 flex flex-col items-center space-y-6">
              {/* 인천대 마스코트 횃불이 이미지 (두 번째 첨부된 사진) */}
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-r from-blue-400 to-sky-400 rounded-3xl blur-md opacity-60 group-hover:opacity-100 transition duration-300"></div>
                <div className={`relative rounded-2xl p-2.5 border-2 shadow-inner overflow-hidden ${
                  theme === "dark" ? "bg-slate-800 border-sky-400/40" : "bg-white border-blue-200"
                }`}>
                  <Image
                    src="/torch.jpg"
                    alt="인천대학교 마스코트 횃불이"
                    width={150}
                    height={150}
                    className="object-contain rounded-xl hover:scale-105 transition-transform duration-200"
                    priority
                  />
                </div>
              </div>

              {/* 제작자 학과, 학번, 이름 정보 표시 */}
              <div className={`w-full rounded-xl p-4 border flex flex-col gap-2.5 text-sm shadow-xs ${
                theme === "dark" ? "bg-slate-800/80 border-slate-700/80 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
              }`}>
                <div className="flex items-center justify-between border-b border-dashed border-slate-300 dark:border-slate-700 pb-2">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">제작자 학과</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-300">자유전공학부(자연)</span>
                </div>
                <div className="flex items-center justify-between border-b border-dashed border-slate-300 dark:border-slate-700 pb-2">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">학번</span>
                  <span className="font-mono font-bold text-amber-600 dark:text-amber-300">202602579</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">이름</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-300">노서연</span>
                </div>
              </div>

              {/* 게임 룰 & 미션 안내 */}
              <div className={`w-full rounded-xl p-3.5 border text-xs leading-relaxed ${
                theme === "dark" ? "bg-blue-950/40 border-blue-800/40 text-blue-200" : "bg-blue-50/80 border-blue-200 text-blue-900"
              }`}>
                <p className="font-bold mb-1.5 flex items-center gap-1.5 text-blue-600 dark:text-cyan-300">
                  <Sparkles className="w-3.5 h-3.5" /> 미션 클리어 규칙
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300">
                  <li><strong className="text-rose-600 dark:text-rose-300 font-bold">★ 연한 빨강색 블록 3개</strong>를 제거하면 즉시 미션 성공!</li>
                  <li>생명은 <span className="text-rose-600 dark:text-rose-400 font-semibold">총 3번</span>이며, 모두 소진 시 실패합니다.</li>
                  <li>PC: <strong>좌우 방향키(←, →)</strong> / 모바일: 화면 터치 드래그로 조작합니다.</li>
                </ul>
              </div>

              {/* 사용자 이름란 및 게임 시작 버튼 */}
              <div className="w-full space-y-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                    <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    플레이어 이름
                  </label>
                  <Input
                    type="text"
                    placeholder="이름이나 닉네임을 입력하세요"
                    value={userName}
                    onChange={(e) => {
                      setUserName(e.target.value);
                      if (inputError) setInputError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleStartLobby();
                    }}
                    className={`h-11 text-base ${
                      theme === "dark"
                        ? "bg-slate-950/70 border-slate-700 text-white placeholder:text-slate-500"
                        : "bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                    }`}
                    maxLength={15}
                  />
                  {inputError && (
                    <p className="text-xs text-rose-500 font-medium">{inputError}</p>
                  )}
                </div>

                <Button
                  onClick={handleStartLobby}
                  className="w-full h-12 text-base font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 text-white shadow-lg shadow-blue-500/25 transition-all duration-200 transform hover:-translate-y-0.5 cursor-pointer"
                >
                  <Play className="w-5 h-5 mr-2 fill-current" />
                  게임 시작하기
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* =================== 게임 플레이 화면 =================== */
          <div className="flex flex-col items-center w-full space-y-3">
            {/* 상단 컨트롤 및 상태 대시보드 */}
            <div className={`w-full flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-4 py-3 border shadow-md transition-colors ${
              theme === "dark" ? "bg-slate-900/90 border-slate-800 text-white" : "bg-white/95 border-slate-200 text-slate-800 shadow-slate-200/50"
            }`}>
              {/* 좌측: 플레이어 & 조작 버튼(일시정지 / 다시 시작) */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRestartToLobby}
                  className={`h-8 px-2.5 text-xs font-semibold cursor-pointer ${
                    theme === "dark" ? "border-slate-700 hover:bg-slate-800 text-slate-300" : "border-slate-300 hover:bg-slate-100 text-slate-700"
                  }`}
                  title="이름 입력 화면으로 돌아가기"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  다시 시작 (이름 변경)
                </Button>

                {/* 게임 일시정지 / 계속하기 버튼 (요구사항: 메인 화면에는 게임을 중간에 멈출 수 있는 버튼 구성) */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={togglePause}
                  disabled={gameStatus === "cleared" || gameStatus === "failed" || countdown !== null}
                  className={`h-8 px-2.5 text-xs font-semibold cursor-pointer ${
                    gameStatus === "paused"
                      ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600"
                      : theme === "dark"
                      ? "border-slate-700 hover:bg-slate-800 text-slate-300"
                      : "border-slate-300 hover:bg-slate-100 text-slate-700"
                  }`}
                >
                  {gameStatus === "paused" ? (
                    <>
                      <Play className="w-3.5 h-3.5 mr-1 fill-current" />
                      계속하기
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5 mr-1 fill-current" />
                      일시정지
                    </>
                  )}
                </Button>

                <div className="hidden sm:flex items-center gap-1.5 ml-1">
                  <span className="text-xs text-slate-500">플레이어:</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                    {userName}
                  </span>
                </div>
              </div>

              {/* 중앙: 연한 빨강 블록 미션 달성 현황 */}
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`px-3 py-1 flex items-center gap-1.5 text-xs font-bold ${
                    theme === "dark"
                      ? "bg-rose-950/60 border-rose-500/60 text-rose-200"
                      : "bg-rose-50 border-rose-300 text-rose-700"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                  <span>연한 빨강 블록 제거:</span>
                  <span className="font-black text-sm text-rose-600 dark:text-rose-300">
                    {redClearedCount} / {REQUIRED_RED_COUNT}
                  </span>
                </Badge>
              </div>

              {/* 우측: 생명 & 시간 */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1" title="남은 생명">
                  {[1, 2, 3].map((heartIndex) => (
                    <Heart
                      key={heartIndex}
                      className={`w-4 h-4 sm:w-5 sm:h-5 transition-all ${
                        heartIndex <= lives
                          ? "text-rose-500 fill-rose-500 scale-100 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]"
                          : "text-slate-300 dark:text-slate-600 scale-90"
                      }`}
                    />
                  ))}
                </div>

                {/* 미션 실패 상태가 아닐 때만 시간 측정 및 표시 (분:초 단위) */}
                {gameStatus !== "failed" && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    시간: <span className="font-mono text-blue-600 dark:text-cyan-300 font-bold">{formatTime(elapsedTime)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 캔버스 게임 화면 (반응형: max-w-full 및 aspect 비율 유지, 약간 더 넓어진 840x560 캔버스) */}
            <div className={`relative w-full max-w-[840px] aspect-[840/560] rounded-2xl overflow-hidden border-4 shadow-2xl transition-all ${
              theme === "dark" ? "border-slate-800 bg-black" : "border-slate-300 bg-slate-100"
            }`}>
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onTouchMove={handleTouchMove}
                className="w-full h-full block touch-none cursor-crosshair"
              />

              {/* 연한 빨강 블록 제거 시 따봉 1초 띄우기 (요구사항: 연한 빨강 블록 하나 깰 때마다 따봉 아이콘 1초간 띄우기) */}
              {showThumbsUp && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 select-none animate-in zoom-in-50 fade-in duration-150">
                  <div className="bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 px-6 py-4 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.8)] border-2 border-white flex items-center gap-3 animate-bounce">
                    <ThumbsUp className="w-10 h-10 text-slate-950 fill-slate-950 stroke-[2.5]" />
                    <div className="text-left">
                      <p className="text-xs font-black tracking-wider uppercase text-amber-950">Awesome!</p>
                      <p className="text-xl font-black text-slate-950">연한 빨강 제거!</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 준비 카운트다운 3, 2, 1 오버레이 (요구사항: 게임이 처음 시작할 때만 준비 카운트 3, 2, 1 후 공의 움직임 시작) */}
              {countdown !== null && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none select-none animate-in fade-in duration-200">
                  <div className="text-center">
                    <p className="text-xl sm:text-2xl font-bold text-white mb-2 drop-shadow-md">
                      게임 준비!
                    </p>
                    <div className="text-7xl sm:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-amber-500 animate-bounce drop-shadow-[0_0_20px_rgba(245,158,11,0.8)]">
                      {countdown === 0 ? "START!" : countdown}
                    </div>
                    <p className="text-slate-300 text-xs sm:text-sm mt-3">
                      공이 곧 출발합니다! 패들을 준비하세요
                    </p>
                  </div>
                </div>
              )}

              {/* 일시정지 오버레이 */}
              {gameStatus === "paused" && (
                <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in duration-200">
                  <div className="w-14 h-14 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center mb-3">
                    <Pause className="w-7 h-7 text-amber-400 fill-current" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-white mb-2">게임 일시 정지됨</h3>
                  <p className="text-slate-300 text-xs sm:text-sm mb-5">
                    잠시 휴식 중입니다. 계속하려면 아래 버튼을 눌러주세요.
                  </p>
                  <Button
                    onClick={togglePause}
                    className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-6 py-2 cursor-pointer shadow-lg"
                  >
                    <Play className="w-4 h-4 mr-2 fill-current" />
                    게임 재개
                  </Button>
                </div>
              )}

              {/* 게임 성공(미션 완료) 오버레이 */}
              {gameStatus === "cleared" && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-6 text-center animate-in fade-in zoom-in-95 duration-300 z-40 overflow-y-auto">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-yellow-500 to-amber-300 flex items-center justify-center mb-1.5 sm:mb-3 shadow-lg shadow-amber-500/40 shrink-0">
                    <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-slate-950" />
                  </div>
                  <h2 className="text-lg sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-white mb-0.5 sm:mb-1">
                    🎉 게임 미션 완료!
                  </h2>
                  <p className="text-slate-300 text-[11px] sm:text-xs max-w-xs mb-2 sm:mb-3">
                    {userName} 님 대단합니다! 목표인 <strong className="text-rose-400">연한 빨강 블록 3개</strong>를 모두 파괴했습니다!
                  </p>

                  <div className="bg-slate-900/95 border border-slate-700/80 rounded-xl p-3 sm:p-4 mb-2.5 sm:mb-4 w-full max-w-[280px] sm:max-w-xs space-y-2 text-xs sm:text-sm shadow-inner">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                      <span className="text-slate-400 text-xs">내 클리어 시간</span>
                      <span className="font-bold text-cyan-300 font-mono text-sm sm:text-base">{finalClearedTime || formatTime(elapsedTime)}</span>
                    </div>

                    {/* TOP 3 명예의 전당 순위 출력 영역 */}
                    <div className="space-y-1 pt-0.5 text-left">
                      <p className="text-[11px] sm:text-xs font-bold text-amber-400 flex items-center gap-1.5">
                        <Trophy className="w-3 h-3 text-amber-400" />
                        실시간 TOP 3 랭킹 (종료시간 순)
                      </p>

                      {isLoadingRankings ? (
                        <p className="text-[11px] text-slate-400 animate-pulse py-0.5">구글 시트에서 랭킹 불러오는 중...</p>
                      ) : topRankings.length > 0 ? (
                        <div className="space-y-1">
                          {topRankings.map((r, i) => (
                            <div
                              key={i}
                              className={`flex justify-between items-center px-2 py-1 rounded text-[11px] sm:text-xs ${
                                i === 0
                                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/40 font-bold"
                                  : i === 1
                                  ? "bg-slate-700/40 text-slate-200"
                                  : "bg-slate-800/40 text-slate-300"
                              }`}
                            >
                              <span className="flex items-center gap-1.5 truncate mr-2">
                                <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                                  i === 0 ? "bg-amber-400 text-slate-950" : i === 1 ? "bg-slate-300 text-slate-950" : "bg-amber-700 text-white"
                                }`}>
                                  {i + 1}
                                </span>
                                <span className="truncate max-w-[100px] sm:max-w-[120px]">{r.name}</span>
                              </span>
                              <span className="font-mono font-bold text-cyan-300 shrink-0">{r.finishtime}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 py-0.5">저장된 랭킹 기록을 확인하는 중입니다...</p>
                      )}
                    </div>

                    {isSavingToSheet && (
                      <p className="text-[11px] text-blue-300 animate-pulse pt-0.5">구글 시트에 기록 저장 중...</p>
                    )}
                    {saveSheetSuccess === true && (
                      <p className="text-[11px] text-emerald-400 pt-0.5">✓ 구글 시트에 성공 기록이 저장되었습니다</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleRetryCurrentGame}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm h-8 sm:h-9 px-3 cursor-pointer shadow-md"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      다시하기
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRestartToLobby}
                      className="border-slate-600 text-slate-300 hover:bg-slate-800 text-xs sm:text-sm h-8 sm:h-9 px-3 cursor-pointer"
                    >
                      이름 변경(메인)
                    </Button>
                  </div>
                </div>
              )}

              {/* 게임 실패 오버레이 */}
              {gameStatus === "failed" && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-6 text-center animate-in fade-in zoom-in-95 duration-300 z-40 overflow-y-auto">
                  <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-rose-950/80 border-2 border-rose-500/80 flex items-center justify-center mb-2 shadow-lg shadow-rose-900/50 shrink-0">
                    <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-rose-400" />
                  </div>
                  <h2 className="text-lg sm:text-2xl font-black text-rose-400 mb-1">
                    게임 미션 실패
                  </h2>
                  <p className="text-slate-300 text-xs max-w-xs mb-4">
                    {userName} 님의 모든 생명이 소진되었습니다.<br />
                    <span className="text-slate-400 text-[11px] mt-0.5 block">
                      (미션 실패로 소요 시간은 측정 및 기록되지 않습니다)
                    </span>
                  </p>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleRetryCurrentGame}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm h-8 sm:h-9 px-3 cursor-pointer shadow-md shadow-rose-600/30"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      다시 시도
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRestartToLobby}
                      className="border-slate-600 text-slate-300 hover:bg-slate-800 text-xs sm:text-sm h-8 sm:h-9 px-3 cursor-pointer"
                    >
                      이름 변경(메인)
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 모바일 가상 컨트롤러 제거됨 */}

            {/* 하단 단축키 안내 */}
            <div className="hidden sm:flex items-center justify-between w-full max-w-[840px] text-xs text-slate-500 dark:text-slate-400 px-2">
              <div className="flex items-center gap-2">
                <span className="bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded font-mono font-bold text-slate-700 dark:text-slate-300">←</span>
                <span className="bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded font-mono font-bold text-slate-700 dark:text-slate-300">→</span>
                <span>패들 이동</span>
                <span className="mx-1 text-slate-300 dark:text-slate-700">|</span>
                <span className="bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded font-mono font-bold text-slate-700 dark:text-slate-300">Space / P</span>
                <span>일시정지</span>
              </div>
              <div>
                <span>인천대 자유전공학부(자연) 202602579 노서연</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 3. 메인 페이지 하단 저작권 푸터 (요구사항: 메인 페이지 하단에 Copyright INU 벽돌깨기 by Seoyeon 추가) */}
      <footer className={`w-full py-4 px-6 text-center text-xs border-t transition-colors ${
        theme === "dark" ? "bg-slate-900/60 border-slate-800 text-slate-500" : "bg-white/60 border-slate-200 text-slate-500"
      }`}>
        <p className="font-medium tracking-wide">
          Copyright INU 벽돌깨기 by Seoyeon
        </p>
      </footer>
    </div>
  );
}
