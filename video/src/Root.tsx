import {
  Composition,
  getStaticFiles,
  staticFile,
  type CalculateMetadataFunction,
} from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { Stillpaid, type SceneTiming } from "./Stillpaid";
import { FPS, scenes } from "./script";

type Props = { scenes: SceneTiming[] };

const defaults: Props = {
  scenes: scenes.map((s) => ({ ...s, audio: null })),
};

// A recording in public/vo/<scene>.mp3 plays at the start of its scene; the
// scene grows to fit it, so each take can be re-recorded on its own.
const calculateMetadata: CalculateMetadataFunction<Props> = async () => {
  const files = new Set(getStaticFiles().map((f) => f.name));
  const timed: SceneTiming[] = [];
  for (const s of scenes) {
    const name = `vo/${s.id}.mp3`;
    if (!files.has(name)) {
      timed.push({ ...s, audio: null });
      continue;
    }
    const seconds = await getAudioDurationInSeconds(staticFile(name));
    timed.push({
      ...s,
      audio: name,
      frames: Math.max(s.frames, Math.ceil((seconds + 0.6) * FPS)),
    });
  }
  return {
    durationInFrames: timed.reduce((n, s) => n + s.frames, 0),
    props: { scenes: timed },
  };
};

export const Root = () => (
  <Composition
    id="Stillpaid"
    component={Stillpaid}
    defaultProps={defaults}
    calculateMetadata={calculateMetadata}
    durationInFrames={defaults.scenes.reduce((n, s) => n + s.frames, 0)}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
