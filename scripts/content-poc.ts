/* eslint-disable no-console */
//
// Minimal content-recording POC runner.
//
// Preconditions:
//   1) `npm run dev` is running locally.
//   2) Target route is non-daily /play/<id> so `meta.solution` is available.
//   3) Run with `npm run content:poc`.
//
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices, type Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { getGrid, gotoPlayPuzzle, gridCellAt } from "@/e2e/helpers/test-helpers";
import {
  buildHumanPlan,
  createRng,
  jitterMs,
  PACE_PRESETS,
  sleep,
  type PuzzleSnapshot,
} from "./content-poc-moves";
import {
  decideAgentMove,
  pickCorrectionDigit,
  shouldAddNotes,
} from "./content-poc-agent";

type RunSummary = {
  runId: number;
  puzzleId: number;
  approach: "solution" | "agent";
  movesCount: number;
  notesCount: number;
  correctionsCount: number;
  guessesCount: number;
  durationMs: number;
  pace: (typeof PACE_PRESETS)[number];
  videoPath: string;
  metadataPath: string;
};

const OUTPUT_ROOT = path.join(process.cwd(), "artifacts", "content-poc");

async function readPuzzleSnapshot(page: Page): Promise<PuzzleSnapshot> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __sudokuStore?: {
        getState: () => {
          board: Uint8Array;
          mode: "value" | "notes";
          meta: {
            mode: "daily" | "random";
            solution: string | null;
          } | null;
          setMode: (mode: "value" | "notes") => void;
        };
      };
    };
    if (!win.__sudokuStore) throw new Error("__sudokuStore not found on window");
    const state = win.__sudokuStore.getState();
    state.setMode("value");
    return {
      board: Array.from(state.board),
      mode: state.meta?.mode ?? "random",
      solution: state.meta?.solution ?? null,
    };
  });
}

async function ensureDevServerUp(page: Page): Promise<void> {
  let response: Awaited<ReturnType<Page["goto"]>> | null = null;
  try {
    response = await page.goto("/");
  } catch {
    throw new Error(
      "Could not reach local app on http://localhost:3000. Start `npm run dev`, then rerun `npm run content:poc`.",
    );
  }
  if (!response || response.status() >= 400) {
    throw new Error(
      "Local app responded with an error status. Start `npm run dev`, confirm the app loads, then rerun `npm run content:poc`.",
    );
  }
}

async function playMovesViaUi(page: Page, puzzleId: number, runId: number): Promise<RunSummary> {
  const startedAt = Date.now();
  const pace = PACE_PRESETS[(runId - 1) % PACE_PRESETS.length];
  try {
    await gotoPlayPuzzle(page, puzzleId);
  } catch {
    throw new Error(
      `Could not load /play/${puzzleId} with a visible Sudoku grid. Seed local puzzles or run with CONTENT_POC_PUZZLE_IDS=<id1,id2,id3>.`,
    );
  }
  const grid = getGrid(page);
  const snapshot = await readPuzzleSnapshot(page);
  const rng = createRng(Date.now() + runId * 9_973 + puzzleId * 131);
  const plan = buildHumanPlan(snapshot, rng);

  await setInputMode(page, "notes");
  for (const noteAction of plan.noteActions) {
    await gridCellAt(grid, noteAction.row, noteAction.col).click();
    for (const digit of noteAction.digits) {
      await page.getByRole("button", { name: new RegExp(`^Toggle note ${digit}`) }).click();
      await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.5), Math.floor(pace.jitterMs * 0.4)));
    }
    await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.6), Math.floor(pace.jitterMs * 0.5)));
  }

  await setInputMode(page, "value");

  for (let moveIndex = 0; moveIndex < plan.fillMoves.length; moveIndex++) {
    const move = plan.fillMoves[moveIndex];
    await gridCellAt(grid, move.row, move.col).click();

    if (plan.correctionCellIndexes.has(move.cellIndex)) {
      const wrongDigit = pickWrongDigit(move.digit, rng);
      await page.getByRole("button", { name: new RegExp(`^Place ${wrongDigit}`) }).click();
      await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.8), Math.floor(pace.jitterMs * 0.6)));
      await page.getByRole("button", { name: "Erase", exact: true }).click();
      await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.7), Math.floor(pace.jitterMs * 0.5)));
    }

    await page.getByRole("button", { name: new RegExp(`^Place ${move.digit}`) }).click();

    if ((moveIndex + 1) % pace.thinkingPauseEveryNMoves === 0)
      await sleep(jitterMs(pace.thinkingPauseMs, pace.jitterMs));

    await sleep(jitterMs(pace.tapDelayMs, pace.jitterMs));
  }

  await expect(page.getByRole("heading", { name: "Solved!" })).toBeVisible();
  const complete = await page.evaluate(() => {
    const win = window as unknown as {
      __sudokuStore?: { getState: () => { isComplete: boolean } };
    };
    return win.__sudokuStore?.getState().isComplete === true;
  });
  if (!complete) throw new Error("expected isComplete=true after move playback");

  return {
    runId,
    puzzleId,
    approach: "solution",
    movesCount: plan.fillMoves.length,
    notesCount: plan.noteActions.length,
    correctionsCount: plan.correctionCellIndexes.size,
    guessesCount: 0,
    durationMs: Date.now() - startedAt,
    pace,
    videoPath: "",
    metadataPath: "",
  };
}

async function playViaAgent(page: Page, puzzleId: number, runId: number): Promise<RunSummary> {
  const startedAt = Date.now();
  const pace = PACE_PRESETS[(runId - 1) % PACE_PRESETS.length];
  try {
    await gotoPlayPuzzle(page, puzzleId);
  } catch {
    throw new Error(`Could not load /play/${puzzleId} with a visible Sudoku grid.`);
  }
  const grid = getGrid(page);
  const rng = createRng(Date.now() + runId * 7_111 + puzzleId * 97);

  let movesCount = 0;
  let notesCount = 0;
  let correctionsCount = 0;
  let guessesCount = 0;
  let stalledTurns = 0;
  const maxTurns = 220;

  while (movesCount < maxTurns) {
    const state = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore?: {
          getState: () => {
            board: Uint8Array;
            isComplete: boolean;
            meta: { variant?: string | null } | null;
          };
        };
      };
      if (!win.__sudokuStore) throw new Error("__sudokuStore not found");
      const current = win.__sudokuStore.getState();
      return {
        board: Array.from(current.board),
        isComplete: current.isComplete,
        variant: current.meta?.variant ?? "standard",
      };
    });
    if (state.isComplete) break;

    const decision = decideAgentMove(state.board, state.variant, rng);
    if (!decision) {
      stalledTurns++;
      if (stalledTurns > 2) break;
      await sleep(jitterMs(Math.floor(pace.thinkingPauseMs * 1.2), pace.jitterMs));
      continue;
    }
    stalledTurns = 0;

    const row = Math.floor(decision.cellIndex / 9) + 1;
    const col = (decision.cellIndex % 9) + 1;
    const shouldNote = shouldAddNotes(decision, rng);

    await gridCellAt(grid, row, col).click();
    if (shouldNote) {
      await setInputMode(page, "notes");
      const noteDigits = decision.candidateDigits.slice(0, Math.min(3, decision.candidateDigits.length));
      for (const digit of noteDigits) {
        await page.getByRole("button", { name: new RegExp(`^Toggle note ${digit}`) }).click();
        await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.45), Math.floor(pace.jitterMs * 0.35)));
      }
      notesCount++;
      await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.6), Math.floor(pace.jitterMs * 0.45)));
    }

    await setInputMode(page, "value");
    const correctionDigit =
      !decision.guessed && rng() < 0.22 ? pickCorrectionDigit(decision, rng) : null;
    if (correctionDigit) {
      await page.getByRole("button", { name: new RegExp(`^Place ${correctionDigit}`) }).click();
      await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.7), Math.floor(pace.jitterMs * 0.5)));
      await page.getByRole("button", { name: "Erase", exact: true }).click();
      correctionsCount++;
      await sleep(jitterMs(Math.floor(pace.tapDelayMs * 0.6), Math.floor(pace.jitterMs * 0.45)));
    }

    await page.getByRole("button", { name: new RegExp(`^Place ${decision.digit}`) }).click();
    movesCount++;
    if (decision.guessed) guessesCount++;

    if (movesCount % pace.thinkingPauseEveryNMoves === 0)
      await sleep(jitterMs(Math.floor(pace.thinkingPauseMs * 1.25), pace.jitterMs));
    await sleep(jitterMs(Math.floor(pace.tapDelayMs * 1.1), pace.jitterMs));
  }

  await expect(page.getByRole("heading", { name: "Solved!" })).toBeVisible();
  const complete = await page.evaluate(() => {
    const win = window as unknown as {
      __sudokuStore?: { getState: () => { isComplete: boolean } };
    };
    return win.__sudokuStore?.getState().isComplete === true;
  });
  if (!complete) throw new Error("agent run did not complete puzzle");

  return {
    runId,
    puzzleId,
    approach: "agent",
    movesCount,
    notesCount,
    correctionsCount,
    guessesCount,
    durationMs: Date.now() - startedAt,
    pace,
    videoPath: "",
    metadataPath: "",
  };
}

async function setInputMode(page: Page, target: "value" | "notes"): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const hasValueButtons = (await page.getByRole("button", { name: /^Place 1/ }).count()) > 0;
    const current = hasValueButtons ? "value" : "notes";
    if (current === target) return;
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await sleep(120);
  }
  throw new Error(`failed to switch to ${target} mode`);
}

function pickWrongDigit(correctDigit: number, rng: () => number): number {
  const alternatives = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => digit !== correctDigit);
  return alternatives[Math.floor(rng() * alternatives.length)];
}

async function run(): Promise<void> {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const summaries: RunSummary[] = [];
  const approach = parseApproach();

  try {
    const probeContext = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    });
    const probePage = await probeContext.newPage();
    await ensureDevServerUp(probePage);
    const puzzleIds = await resolvePuzzleIds(probePage);
    const runIds = await reserveRunIds(puzzleIds.length);
    console.log(`[content:poc] approach=${approach}, puzzle IDs: ${puzzleIds.join(", ")}`);
    console.log(`[content:poc] writing runs: ${runIds.join(", ")}`);
    await probeContext.close();

    for (let i = 0; i < puzzleIds.length; i++) {
      const runId = runIds[i];
      const puzzleId = puzzleIds[i];
      const runDir = path.join(OUTPUT_ROOT, `run-${runId}`);
      await mkdir(runDir, { recursive: true });

      const context = await browser.newContext({
        ...devices["Pixel 7"],
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        recordVideo: {
          dir: runDir,
          size: { width: 412, height: 915 },
        },
      });
      const page = await context.newPage();

      console.log(`[run ${runId}] puzzle ${puzzleId}: autoplay start (${approach})`);
      const summary =
        approach === "agent"
          ? await playViaAgent(page, puzzleId, runId)
          : await playMovesViaUi(page, puzzleId, runId);
      const videoHandle = page.video();
      if (!videoHandle) throw new Error("recorded video handle missing");
      await context.close();

      const rawVideoPath = await videoHandle.path();
      const finalVideoPath = path.join(runDir, `puzzle-${puzzleId}-run-${runId}.webm`);
      await rename(rawVideoPath, finalVideoPath);

      const metadataPath = path.join(runDir, `puzzle-${puzzleId}-run-${runId}.json`);
      const metadata = {
        ...summary,
        videoPath: finalVideoPath,
        metadataPath,
        capturedAt: new Date().toISOString(),
      };
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

      summaries.push({ ...summary, videoPath: finalVideoPath, metadataPath });
      console.log(
        `[run ${runId}] done in ${summary.durationMs}ms, moves=${summary.movesCount}, notes=${summary.notesCount}, corrections=${summary.correctionsCount}, guesses=${summary.guessesCount}, video=${finalVideoPath}`,
      );
    }
  } finally {
    await browser.close();
  }

  console.log("\nPOC complete. Generated assets:");
  for (const entry of summaries) {
    console.log(
      `- run ${entry.runId}: puzzle ${entry.puzzleId} -> ${entry.videoPath} (meta: ${entry.metadataPath})`,
    );
  }
}

function parsePuzzleIdsFromEnv(): number[] | null {
  const raw = process.env.CONTENT_POC_PUZZLE_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (ids.length !== 3) {
    throw new Error(
      "CONTENT_POC_PUZZLE_IDS must include exactly 3 comma-separated positive integers (example: 8,11,15).",
    );
  }
  return ids;
}

async function resolvePuzzleIds(page: Page): Promise<number[]> {
  const fromEnv = parsePuzzleIdsFromEnv();
  if (fromEnv) return fromEnv;
  return discoverPuzzleIds(page);
}

async function discoverPuzzleIds(page: Page): Promise<number[]> {
  const discovered = new Set<number>();
  const maxProbeId = Number(process.env.CONTENT_POC_MAX_PROBE_ID ?? "160");

  for (let candidateId = 1; candidateId <= maxProbeId; candidateId++) {
    if (discovered.size >= 3) break;
    const response = await page.goto(`/play/${candidateId}`, {
      timeout: 8_000,
      waitUntil: "domcontentloaded",
    });
    if (!response || response.status() >= 400) continue;
    try {
      await expect(getGrid(page)).toBeVisible({ timeout: 5_000 });
    } catch {
      continue;
    }
    await page.waitForFunction(
      () =>
        typeof window !== "undefined" &&
        typeof (window as unknown as { __sudokuStore?: unknown }).__sudokuStore ===
          "function",
      null,
      { timeout: 3_000 },
    );

    const hasSolution = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore?: {
          getState: () => { meta: { solution: string | null } | null };
        };
      };
      return !!win.__sudokuStore?.getState().meta?.solution;
    });
    if (!hasSolution) continue;

    discovered.add(candidateId);
  }

  if (discovered.size < 3) {
    throw new Error(
      "Could not auto-discover 3 playable puzzle IDs. Seed local puzzles, raise CONTENT_POC_MAX_PROBE_ID, or set CONTENT_POC_PUZZLE_IDS=<id1,id2,id3>.",
    );
  }

  return Array.from(discovered).slice(0, 3);
}

async function reserveRunIds(count: number): Promise<number[]> {
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => []);
  let maxRunId = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^run-(\d+)$/);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > maxRunId) maxRunId = value;
  }

  const runIds: number[] = [];
  for (let i = 1; i <= count; i++) runIds.push(maxRunId + i);
  return runIds;
}

function parseApproach(): "solution" | "agent" {
  const raw = (process.env.CONTENT_POC_APPROACH ?? "solution").trim().toLowerCase();
  if (raw === "solution" || raw === "agent") return raw;
  throw new Error("CONTENT_POC_APPROACH must be either 'solution' or 'agent'.");
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[content:poc] ${message}`);
  process.exit(1);
});
