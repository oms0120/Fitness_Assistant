/**
 * 线上链路冒烟测试：真调 RAG 服务 + 真调大模型，验证 `scripts/eval-answer.ts` 依赖的那条链路。
 *
 * **默认跳过**，因为它要外部依赖（rag-service 在跑、Ollama、大模型 key），
 * 放进 `npm test` 会让测试变成非幂等且要花钱。显式开启：
 *
 *   EVAL_SMOKE=1 npx vitest run src/lib/rag/__tests__/smoke.e2e.test.ts
 *
 * 跑之前先把 rag-service 起起来（见 rag-service/README）。
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  JUDGE_PROMPT_VERSION,
  RAG_PROMPT_VERSION,
  judgeSystemPrompt,
  judgeUserPrompt,
  ragSystemPrompt,
} from "@/lib/ai/prompts";
import { answerJudgementSchema } from "@/lib/ai/types";
import { chatJson, resolveMode } from "@/lib/ai/llm";
import { askWithRag, formatChunks } from "@/lib/rag/ragService";

const GOLDEN = "rag-service/eval/golden.provisional.jsonl";
const enabled = Boolean(process.env.EVAL_SMOKE);

/** 取前 n 条 golden 当 smoke 的输入；文件不存在时返回空，由用例自己 fail 得明白些。 */
function sampleGolden(n: number) {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* 已在 shell 里导出 */
  }
  if (!fs.existsSync(GOLDEN)) return [];
  return fs
    .readFileSync(GOLDEN, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { id: string; question: string })
    .slice(0, n);
}

describe.skipIf(!enabled)("线上链路冒烟（EVAL_SMOKE=1 才跑）", () => {
  const records = sampleGolden(2);

  it("大模型 key 已加载", () => {
    expect(resolveMode()).not.toBe("rule");
  });

  it(
    "askWithRag 走真实检索 + 真实 prompt，并带出 chunks",
    async () => {
      const result = await askWithRag(records[0].question);
      expect(result.answer.length).toBeGreaterThan(0);
      expect(result.chunks.length).toBeGreaterThan(0);
      // sources 与 chunks 同源，别各算一份
      expect(result.sources).toEqual(result.chunks.map((c) => c.source));
      // 评审要用 formatChunks 渲染出与生成时同一份上下文
      expect(ragSystemPrompt(formatChunks(result.chunks))).toContain(result.chunks[0].text.slice(0, 30));
    },
    120_000,
  );

  it(
    "judge prompt + answerJudgementSchema 能走通 chatJson",
    async () => {
      const result = await askWithRag(records[1].question);
      const judgement = await chatJson({
        system: judgeSystemPrompt(),
        user: judgeUserPrompt({
          question: records[1].question,
          answer: result.answer,
          context: formatChunks(result.chunks),
        }),
        schema: answerJudgementSchema,
        maxTokens: 1024,
        promptVersion: JUDGE_PROMPT_VERSION,
      });
      expect(Number.isInteger(judgement.faithfulness)).toBe(true);
      expect(judgement.faithfulness).toBeGreaterThanOrEqual(1);
      expect(judgement.faithfulness).toBeLessThanOrEqual(5);
      expect(Number.isInteger(judgement.relevance)).toBe(true);
      expect(judgement.reasoning.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it("prompt 版本常量已定义", () => {
    expect(RAG_PROMPT_VERSION).toBeTruthy();
    expect(JUDGE_PROMPT_VERSION).toBeTruthy();
  });
});
