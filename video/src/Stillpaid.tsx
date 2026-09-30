import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadSans } from "@remotion/google-fonts/InterTight";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import {
  clientSegments,
  freelancerSegments,
  segmentFrames,
  srcFrame,
  type Segment,
} from "./script";

const serif = loadSerif("normal", {
  weights: ["400"],
  subsets: ["latin"],
}).fontFamily;
loadSerif("italic", { weights: ["400"], subsets: ["latin"] });
const sans = loadSans("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin"],
}).fontFamily;
const mono = loadMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
}).fontFamily;

const C = {
  paper: "#f6f3ec",
  paper2: "#ece7db",
  card: "#fffdf8",
  ink: "#16171b",
  ink2: "#3b3d44",
  muted: "#6e6c66",
  line: "#d9d2c2",
  blue: "#2f55d4",
  amber: "#9a5c00",
  red: "#c2372b",
  green: "#1d7f48",
};

export interface SceneTiming {
  id: string;
  frames: number;
  lines: string[];
  audio: string | null;
}

export const Stillpaid: React.FC<{ scenes: SceneTiming[] }> = ({ scenes }) => {
  let at = 0;
  return (
    <AbsoluteFill
      style={{ background: C.paper, fontFamily: sans, color: C.ink }}
    >
      {scenes.map((s) => {
        const from = at;
        at += s.frames;
        const Body = BODIES[s.id];
        return (
          <Sequence
            key={s.id}
            from={from}
            durationInFrames={s.frames}
            name={s.id}
          >
            <Body frames={s.frames} />
            <Captions lines={s.lines} frames={s.frames} />
            {s.audio ? <Audio src={staticFile(s.audio)} /> : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const useIn = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 } });
};

const Rise: React.FC<{
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, children, style }) => {
  const p = useIn(delay);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 28}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: mono,
      fontSize: 22,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: C.muted,
    }}
  >
    {children}
  </div>
);

/** The mark: an unanswered "…" that turns into a yes. With `draw`, it animates in. */
const Check: React.FC<{ size: number; draw?: boolean }> = ({ size, draw }) => {
  const frame = useCurrentFrame();
  const t = (from: number, to: number) =>
    draw
      ? interpolate(frame, [from, to], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const len = Math.hypot(8.4, 12);
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill={C.ink} />
      <circle cx="8.4" cy="14.4" r="2.4" fill="#f5f2ea" opacity={0.55 * t(6, 12)} />
      <circle cx="12.4" cy="18.4" r="2.4" fill="#9fd9b4" opacity={0.9 * t(14, 20)} />
      <path
        d="M16.4 22.4L24.8 10.4"
        fill="none"
        stroke="#4fcf86"
        strokeWidth="4.8"
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - t(24, 36))}
        opacity={t(23, 24)}
      />
    </svg>
  );
};

const Title: React.FC<{ frames: number }> = () => (
  <AbsoluteFill style={{ justifyContent: "center", padding: "0 180px" }}>
    <Rise>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <Check size={96} draw />
        <span style={{ fontFamily: serif, fontSize: 120 }}>Stillpaid</span>
      </div>
    </Rise>
    <Rise delay={12}>
      <div
        style={{
          fontFamily: serif,
          fontSize: 132,
          lineHeight: 1,
          marginTop: 40,
        }}
      >
        Get paid on sign-off.
      </div>
    </Rise>
    <Rise delay={30}>
      <div
        style={{
          fontFamily: serif,
          fontStyle: "italic",
          fontSize: 132,
          lineHeight: 1.05,
          color: C.green,
        }}
      >
        Or on silence.
      </div>
    </Rise>
  </AbsoluteFill>
);

const Problem: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const day = Math.round(
    interpolate(frame, [20, frames * 0.55], [1, 47], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const chips = [
    "SWIFT fees",
    "3–5 days in transit",
    "10–20 % marketplace fee",
  ];
  return (
    <AbsoluteFill style={{ padding: "150px 180px", gap: 40 }}>
      <Kicker>The problem</Kicker>
      <Rise>
        <div style={{ fontFamily: serif, fontSize: 96, lineHeight: 1 }}>
          Delivered. Invoiced. <span style={{ color: C.red }}>Waiting.</span>
        </div>
      </Rise>
      <div style={{ display: "flex", gap: 60, alignItems: "center" }}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 150,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            minWidth: 520,
          }}
        >
          Day {day}
        </div>
        <Rise delay={40}>
          <div
            style={{
              background: C.card,
              border: `1.5px solid ${C.line}`,
              borderRadius: 18,
              padding: "28px 34px",
              fontSize: 34,
              color: C.ink2,
              maxWidth: 820,
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontSize: 20,
                color: C.muted,
                marginBottom: 10,
              }}
            >
              Re: Invoice 2026-081
            </div>
            “Still have to look at it. I'll get back to you.”
          </div>
        </Rise>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
        {chips.map((c, i) => (
          <Rise key={c} delay={Math.round(frames * 0.6) + i * 12}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 28,
                padding: "14px 22px",
                border: `2px solid ${C.red}`,
                color: C.red,
                borderRadius: 999,
              }}
            >
              {c}
            </div>
          </Rise>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Idea: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const steps = [
    [
      "1 · Fund",
      "Money first",
      "USDC into a program-owned vault per milestone.",
    ],
    [
      "2 · Deliver",
      "Submit",
      "Link + note; its fingerprint is recorded on Solana.",
    ],
    [
      "3 · Review",
      "Silence = approval",
      "Approve, request a change, dispute. Or say nothing: the freelancer is paid.",
    ],
    [
      "4 · Disagree?",
      "Split, arbiter, default",
      "An agreed split, an arbiter, or the default split both accepted up front.",
    ],
  ];
  const glow = interpolate(frame, [frames * 0.55, frames * 0.62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ padding: "130px 120px", gap: 50 }}>
      <Kicker>How it works</Kicker>
      <Rise>
        <div style={{ fontFamily: serif, fontSize: 90, lineHeight: 1 }}>
          Milestone escrow on Solana, with a clock.
        </div>
      </Rise>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
        }}
      >
        {steps.map(([k, t, d], i) => (
          <Rise key={k} delay={20 + i * Math.round(frames * 0.1)}>
            <div
              style={{
                background: C.card,
                border: `2px solid ${i === 2 ? `rgba(29,127,72,${0.25 + glow * 0.75})` : C.line}`,
                boxShadow:
                  i === 2 ? `0 0 0 ${glow * 6}px rgba(29,127,72,.15)` : "none",
                borderRadius: 20,
                padding: 32,
                height: 360,
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 20,
                  letterSpacing: "0.1em",
                  color: C.muted,
                  textTransform: "uppercase",
                }}
              >
                {k}
              </div>
              <div
                style={{
                  fontFamily: serif,
                  fontSize: 52,
                  lineHeight: 1.05,
                  margin: "18px 0 14px",
                }}
              >
                {t}
              </div>
              <div style={{ fontSize: 28, color: C.ink2, lineHeight: 1.35 }}>
                {d}
              </div>
            </div>
          </Rise>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const BrowserFrame: React.FC<{ url: string; children: React.ReactNode }> = ({
  url,
  children,
}) => (
  <div
    style={{
      width: 1600,
      borderRadius: 18,
      overflow: "hidden",
      border: `1.5px solid ${C.line}`,
      boxShadow: "0 40px 80px -30px rgba(40,30,10,.45)",
      background: C.card,
    }}
  >
    <div
      style={{
        height: 52,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 20px",
        background: C.paper2,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      {["#e0655a", "#e3b341", "#5bb46c"].map((c) => (
        <span
          key={c}
          style={{ width: 14, height: 14, borderRadius: 7, background: c }}
        />
      ))}
      <span
        style={{
          marginLeft: 20,
          fontFamily: mono,
          fontSize: 20,
          color: C.muted,
          background: C.card,
          padding: "6px 16px",
          borderRadius: 8,
          flex: 1,
        }}
      >
        {url}
      </span>
    </div>
    <div style={{ width: 1600, height: 1000, position: "relative" }}>
      {children}
    </div>
  </div>
);

const Recording: React.FC<{
  file: string;
  segments: Segment[];
  frames: number;
  kicker: string;
  url: string;
}> = ({ file, segments, frames, kicker, url }) => {
  const frame = useCurrentFrame();
  let at = 0;
  const parts = segments.map((s) => {
    const from = at;
    const len = segmentFrames(s);
    at += len;
    return { s, from, len };
  });
  const last = parts[parts.length - 1];
  const active = parts.find((p) => frame >= p.from && frame < p.from + p.len);
  const video = (s: Segment, len: number) => (
    <OffthreadVideo
      src={staticFile(`clips/${file}`)}
      trimBefore={srcFrame(s.from)}
      playbackRate={s.rate}
      muted
      style={{ width: 1600, height: 1000 }}
      durationInFrames={Math.round(len * s.rate)}
    />
  );
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 92,
      }}
    >
      <div style={{ position: "absolute", left: 160, top: 34 }}>
        <Kicker>{kicker}</Kicker>
      </div>
      <div style={{ transform: "scale(0.8)", transformOrigin: "top center" }}>
        <BrowserFrame url={url}>
          {parts.map(({ s, from, len }) => (
            <Sequence
              key={from}
              from={from}
              durationInFrames={len}
              layout="none"
            >
              {video(s, len)}
            </Sequence>
          ))}
          {frames > at ? (
            <Sequence from={at} durationInFrames={frames - at} layout="none">
              <Freeze frame={last.len - 1}>{video(last.s, last.len)}</Freeze>
            </Sequence>
          ) : null}
          {active?.s.label ? (
            <div
              style={{
                position: "absolute",
                right: 30,
                top: 30,
                fontFamily: mono,
                fontSize: 26,
                background: C.ink,
                color: C.paper,
                padding: "12px 20px",
                borderRadius: 999,
              }}
            >
              ⏩ {active.s.label} · ×{Math.round(active.s.rate)}
            </div>
          ) : null}
        </BrowserFrame>
      </div>
    </AbsoluteFill>
  );
};

const Freelancer: React.FC<{ frames: number }> = ({ frames }) => (
  <Recording
    file="freelancer.webm"
    segments={freelancerSegments}
    frames={frames}
    kicker="Side A · you are the freelancer"
    url="stillpaid.sorevo.de/demo → job page"
  />
);

const Client: React.FC<{ frames: number }> = ({ frames }) => (
  <Recording
    file="client.webm"
    segments={clientSegments}
    frames={frames}
    kicker="Side B · you are the client"
    url="stillpaid.sorevo.de/new → job page"
  />
);

const Tech: React.FC<{ frames: number }> = ({ frames }) => {
  const states: [string, string, number, number][] = [
    ["Funded", C.blue, 0, 1],
    ["Submitted", C.amber, 1, 1],
    ["Released", C.green, 2, 0],
    ["Disputed", C.red, 2, 2],
    ["Settled / Resolved", C.green, 3, 2],
    ["Refunded", C.muted, 1, 0],
  ];
  const facts = [
    "Own Anchor program · 15 instructions",
    "One program-owned vault per milestone",
    "Release on silence: permissionless",
    "Default split: fixed up front, permissionless",
    "Fee payer: users need no SOL",
    "Blinks · Squads as client · verified build",
    "65 program tests · 34 end-to-end checks",
  ];
  return (
    <AbsoluteFill style={{ padding: "120px 120px", gap: 40 }}>
      <Kicker>Under the hood</Kicker>
      <div style={{ display: "flex", gap: 48 }}>
        <div style={{ position: "relative", width: 1040, flexShrink: 0, height: 520 }}>
          {states.map(([name, color, col, row], i) => (
            <Rise
              key={name}
              delay={8 + i * 8}
              style={{ position: "absolute", left: col * 230, top: row * 190 }}
            >
              <div
                style={{
                  border: `3px solid ${color}`,
                  color,
                  fontFamily: mono,
                  fontSize: 26,
                  padding: "18px 22px",
                  borderRadius: 14,
                  background: C.card,
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </div>
            </Rise>
          ))}
          <svg
            width="900"
            height="520"
            style={{
              position: "absolute",
              inset: 0,
              opacity: interpolate(useCurrentFrame(), [50, 70], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <g stroke={C.ink2} strokeWidth="3" fill="none" markerEnd="url(#a)">
              <path d="M150 220 L225 220" />
              <path d="M395 200 L455 80" />
              <path d="M395 240 L455 400" />
              <path d="M640 410 L685 410" />
              <path d="M80 180 L200 60" />
            </g>
            <defs>
              <marker
                id="a"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
              >
                <path d="M0 0 L10 5 L0 10 z" fill={C.ink2} />
              </marker>
            </defs>
          </svg>
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {facts.map((f, i) => (
            <Rise key={f} delay={Math.round(frames * 0.15) + i * 14}>
              <div
                style={{
                  fontSize: 28,
                  display: "flex",
                  gap: 16,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: C.green, fontWeight: 700 }}>✓</span>
                {f}
              </div>
            </Rise>
          ))}
        </div>
      </div>
      <Rise delay={Math.round(frames * 0.7)}>
        <div style={{ fontFamily: mono, fontSize: 24, color: C.muted }}>
          Program 2gbyeNrQm2869HMK2mnSJyHc4cQfDrAGh6dk5ccoVyg4 · Solana devnet
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ frames: number }> = () => {
  const next = [
    "Reminders before the window ends",
    "Invoice PDF with EUR amount",
    "EURC",
    "Multisig upgrade authority",
    "Mainnet pilot",
  ];
  return (
    <AbsoluteFill
      style={{ justifyContent: "center", padding: "0 180px", gap: 36 }}
    >
      <Rise>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Check size={80} />
          <span style={{ fontFamily: serif, fontSize: 96 }}>Stillpaid</span>
        </div>
      </Rise>
      <Rise delay={10}>
        <div style={{ fontFamily: serif, fontSize: 84, lineHeight: 1.05 }}>
          Silence <em style={{ color: C.green }}>still</em> pays.
        </div>
      </Rise>
      <Rise delay={25}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {next.map((n) => (
            <span
              key={n}
              style={{
                fontFamily: mono,
                fontSize: 24,
                padding: "10px 18px",
                border: `1.5px solid ${C.line}`,
                borderRadius: 999,
                background: C.card,
              }}
            >
              {n}
            </span>
          ))}
        </div>
      </Rise>
      <Rise delay={40}>
        <div style={{ fontFamily: mono, fontSize: 30 }}>
          Try it: stillpaid.sorevo.de/demo · github.com/NWichter/stillpaid
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

const BODIES: Record<string, React.FC<{ frames: number }>> = {
  title: Title,
  problem: Problem,
  idea: Idea,
  freelancer: Freelancer,
  client: Client,
  tech: Tech,
  outro: Outro,
};

const Captions: React.FC<{ lines: string[]; frames: number }> = ({
  lines,
  frames,
}) => {
  const frame = useCurrentFrame();
  const words = lines.map((l) => l.split(" ").length);
  const total = words.reduce((a, b) => a + b, 0);
  let acc = 0;
  const idx = lines.findIndex((_, i) => {
    acc += words[i];
    return frame < (acc / total) * frames;
  });
  const line = lines[idx < 0 ? lines.length - 1 : idx];
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 34,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          background: "rgba(22,23,27,.86)",
          color: "#f6f3ec",
          fontSize: 34,
          lineHeight: 1.35,
          padding: "14px 28px",
          borderRadius: 14,
          textAlign: "center",
        }}
      >
        {line}
      </div>
    </div>
  );
};
