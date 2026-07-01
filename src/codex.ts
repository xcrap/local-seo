import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexModel, codexReasoningEffort } from "./config";
import { all, get, run } from "./db";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codexTimeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 600000);
const runningJobs = new Set<string>();

export type AiJob = {
  id: string;
  type: string;
  prompt: string;
  status: string;
  message: string;
  result_text: string;
  result_json: string | null;
  error: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export const promptTemplates = [
  {
    key: "seo.coach",
    label: "SEO coach",
    template:
      "You are a local SEO coach. Given this site context, recommend the next 5 SEO moves with evidence and priority. Return concise markdown.\n\n{{context}}",
  },
  {
    key: "keywords.cluster",
    label: "Keyword clustering",
    template:
      "Cluster these keywords by search intent and suggest one target page for each cluster. Return JSON with clusters.\n\n{{context}}",
  },
  {
    key: "audit.prioritize",
    label: "Scan prioritization",
    template:
      "Prioritize these technical SEO scan issues by likely impact, effort, and dependency order. Return concise markdown.\n\n{{context}}",
  },
  {
    key: "competitor.gaps",
    label: "Competitor gaps",
    template:
      "Analyze this domain and competitor context. Identify keyword, content, backlink, and technical gaps. Return a prioritized plan.\n\n{{context}}",
  },
  {
    key: "ai.visibility",
    label: "AI visibility",
    template:
      "Evaluate how this brand should appear in AI answers for the supplied prompts. Identify citations, positioning, and content needed to improve visibility.\n\n{{context}}",
  },
];

export function seedAiPrompts() {
  for (const prompt of promptTemplates) {
    run(
      `
      INSERT INTO ai_prompts (key, label, template)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
      `,
      [prompt.key, prompt.label, prompt.template],
    );
  }
}

export function listAiPrompts() {
  seedAiPrompts();
  return all("SELECT * FROM ai_prompts ORDER BY key");
}

export function saveAiPrompt(key: string, template: string) {
  const existing = promptTemplates.find((prompt) => prompt.key === key);
  run(
    `
    INSERT INTO ai_prompts (key, label, template, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET template = excluded.template, updated_at = CURRENT_TIMESTAMP
    `,
    [key, existing?.label || key, template],
  );
}

export function createAiJob(input: { type: string; prompt: string }) {
  const id = randomUUID();
  run(
    "INSERT INTO ai_jobs (id, type, prompt, status, message) VALUES (?, ?, ?, 'queued', 'Queued')",
    [id, input.type, input.prompt],
  );
  queueMicrotask(() => {
    runAiJob(id).catch((error) => {
      failJob(id, error instanceof Error ? error.message : "Codex job failed");
    });
  });
  return getAiJob(id)!;
}

export function listAiJobs(limit?: number) {
  if (limit && limit > 0) {
    return all<AiJob>("SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT ?", [limit]);
  }
  return all<AiJob>("SELECT * FROM ai_jobs ORDER BY created_at DESC");
}

export function getAiJob(id: string) {
  return get<AiJob>("SELECT * FROM ai_jobs WHERE id = ?", [id]);
}

function updateJob(id: string, patch: Partial<AiJob>) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const set = entries.map(([key]) => `${key} = ?`).join(", ");
  run(`UPDATE ai_jobs SET ${set} WHERE id = ?`, [...entries.map(([, value]) => value), id]);
}

function failJob(id: string, message: string) {
  updateJob(id, {
    status: "failed",
    message: "Failed",
    error: message.slice(0, 2000),
    finished_at: new Date().toISOString(),
  });
  runningJobs.delete(id);
}

async function runAiJob(id: string) {
  if (runningJobs.has(id)) return;
  runningJobs.add(id);
  const job = getAiJob(id);
  if (!job || job.status !== "queued") {
    runningJobs.delete(id);
    return;
  }
  updateJob(id, {
    status: "running",
    message: "Codex is working",
    started_at: new Date().toISOString(),
  });
  try {
    const result = await runCodex(job.prompt);
    updateJob(id, {
      status: "completed",
      message: "Completed",
      result_text: result.text,
      result_json: result.json ? JSON.stringify(result.json) : null,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    failJob(id, error instanceof Error ? error.message : "Codex job failed");
  } finally {
    runningJobs.delete(id);
  }
}

async function runCodex(prompt: string): Promise<{ text: string; json: unknown | null }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-codex-"));
  mkdirSync(tempDir, { recursive: true });
  const outputPath = path.join(tempDir, "last-message.txt");
  try {
    const args = [
      "codex",
      "--search",
      "--ask-for-approval",
      "never",
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-C",
      rootDir,
      "-s",
      "read-only",
    ];
    const model = codexModel();
    const effort = codexReasoningEffort();
    if (model) args.push("--model", model);
    if (effort) args.push("--config", `model_reasoning_effort="${effort}"`);
    args.push("-o", outputPath, prompt);

    const proc = Bun.spawn(args, {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    let timeoutId: Timer | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error("Codex job timed out."));
      }, codexTimeoutMs);
    });
    const exitCode = await Promise.race([proc.exited, timeout]);
    if (timeoutId) clearTimeout(timeoutId);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    if (exitCode !== 0) {
      throw new Error((stderr || stdout || `Codex exited with ${exitCode}`).slice(0, 2000));
    }
    const text = (await readFile(outputPath, "utf8").catch(() => stdout)).trim();
    return { text, json: parseMaybeJson(text) };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function parseMaybeJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
