import clips from "./clips.json";

export const FPS = 30;

/** A stretch of a recording, played at `rate` (source seconds per output second). */
export interface Segment {
  from: number;
  to: number;
  rate: number;
  label?: string;
}

/** Waiting is compressed to `seconds` of output, everything else plays near real time. */
const squeeze = (
  from: number,
  to: number,
  seconds: number,
  label?: string,
): Segment => ({
  from,
  to,
  rate: Math.max(1, (to - from) / seconds),
  label,
});

const f = clips.freelancer;
const c = clips.client;

const keep = (segs: Segment[]) => segs.filter((s) => s.to - s.from > 0.2);

export const freelancerSegments: Segment[] = keep([
  { from: Math.max(0, f.demo - 1), to: f.demo + 6, rate: 1.15 },
  squeeze(f.demo + 6, f.hired, 1.5, "demo client funds the job"),
  { from: f.hired, to: f.submitted + 3, rate: 1.15 },
  squeeze(f.submitted + 3, f.paid - 1.5, 5, "90-second review window · sped up"),
  { from: f.paid - 1.5, to: f.end, rate: 1 },
]);

const typed = Math.min(c.delivered + 7, c.v2 - 0.5);
const disputed = Math.min(c.v2 + 7.5, c.offer - 0.5);
export const clientSegments: Segment[] = keep([
  { from: c.demo, to: c.form + 2, rate: 1.3 },
  squeeze(c.form + 2, c.created - 1, 1, "funding the escrow"),
  { from: c.created - 1, to: c.created + 1.5, rate: 1.2 },
  squeeze(c.created + 1.5, c.delivered, 2, "demo freelancer delivers"),
  { from: c.delivered, to: typed, rate: 1.2 },
  squeeze(typed, c.v2, 1.5, "version 2 arrives"),
  { from: c.v2, to: disputed, rate: 1.2 },
  squeeze(disputed, c.offer - 0.5, 1.5, "freelancer offers a split"),
  { from: c.offer - 0.5, to: c.end, rate: 1.2 },
]);

export const segmentFrames = (s: Segment) =>
  Math.round(((s.to - s.from) / s.rate) * FPS);
/** Remotion trims videos in composition frames. */
export const srcFrame = (sec: number) => Math.round(sec * FPS);
const total = (segs: Segment[]) =>
  segs.reduce((n, s) => n + segmentFrames(s), 0);

export interface Scene {
  id: string;
  frames: number;
  /** Voice-over lines; they also run as subtitles, spread over the scene. */
  lines: string[];
}

export const scenes: Scene[] = [
  {
    id: "title",
    frames: 5 * FPS,
    lines: ["This is Stillpaid.", "Get paid on sign-off. Or on silence."],
  },
  {
    id: "problem",
    frames: 13 * FPS,
    lines: [
      "You deliver the work, and then you wait.",
      "The client still has to look at it. Weeks go by.",
      "Across borders it's worse: SWIFT fees, days in transit, or a marketplace taking ten to twenty percent.",
    ],
  },
  {
    id: "idea",
    frames: 15 * FPS,
    lines: [
      "Stillpaid brings optimistic payments to client work, on Solana. The client funds each milestone before work starts.",
      "The freelancer submits. The client gets a fixed review window to approve, request a change, or dispute.",
      "And if the client says nothing, the delivery counts as accepted, and anyone can release the money.",
    ],
  },
  {
    id: "freelancer",
    frames: total(freelancerSegments),
    lines: [
      "Here's the freelancer side on devnet. No Phantom needed: a throwaway demo wallet works, and the app pays all network fees.",
      "A demo client has already put 25 USDC into escrow. I accept the terms and submit my delivery. Its fingerprint goes on-chain.",
      "Now the client stays silent. When the review window runs out, anyone can release the payment. Our crank does it within half a minute.",
      "Paid on silence, with every step linked to its transaction.",
    ],
  },
  {
    id: "client",
    frames: total(clientSegments),
    lines: [
      "Now the client side. I fund a job for the demo freelancer, and it delivers within about twenty seconds.",
      "I send a change request, and it submits version two. I still disagree and open a dispute.",
      "The freelancer offers a split, I accept exactly that offer, and the program pays out sixty-forty.",
    ],
  },
  {
    id: "tech",
    frames: 13 * FPS,
    lines: [
      "Under the hood: our own Anchor program with fifteen instructions and one program-owned vault per milestone.",
      "Release on silence and the default split are permissionless, so nobody depends on our server.",
      "Every job is also a Solana Blink, a Squads multisig can be the client, and the deployed program matches a verifiable build.",
      "Sixty-five program tests and thirty-four end-to-end checks.",
    ],
  },
  {
    id: "outro",
    frames: 9 * FPS,
    lines: [
      "Next: reminders, invoices, EURC, and a mainnet pilot.",
      "Stillpaid. Because silence still pays.",
    ],
  },
];

export const durationInFrames = scenes.reduce((n, s) => n + s.frames, 0);
