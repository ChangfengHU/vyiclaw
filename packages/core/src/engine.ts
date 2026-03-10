import { spawn } from "child_process";

export interface DebateEvent {
  type: "agent_start" | "token" | "agent_done" | "handoff" | "workflow_complete";
  agentId?: string;
  token?: string;
  result?: string;
  from?: string;
  to?: string;
  message?: string;
}

export interface DevEvent {
  type: "agent_start" | "token" | "agent_done" | "handoff" | "workflow_complete";
  agentId?: string;
  token?: string;
  result?: string;
  from?: string;
  to?: string;
  message?: string;
}

export interface DebateResult {
  pro: string;
  con: string;
  proRebuttal: string;
  conRebuttal: string;
  summary: string;
}

export interface DevResult {
  plan: string;
  implementation: string;
  review: string;
}

export class AgentEngine {
  async runAgent(
    agentId: string,
    message: string,
    onToken: (token: string) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["agent", "--local", "--agent", agentId, "--message", message];
      const proc = spawn("openclaw", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let fullOutput = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        // Stream token by token (split on chars for typewriter effect)
        for (const ch of text) {
          onToken(ch);
        }
      });

      proc.stderr.on("data", (_chunk: Buffer) => {
        // ignore stderr
      });

      proc.on("close", (code) => {
        if (code === 0 || fullOutput.length > 0) {
          resolve(fullOutput.trim());
        } else {
          reject(new Error(`openclaw agent exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        // If openclaw not found, return a mock response
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const mock = `[Mock response from agent ${agentId}]: ${message}`;
          for (const ch of mock) onToken(ch);
          resolve(mock);
        } else {
          reject(err);
        }
      });
    });
  }

  async runDebate(
    topic: string,
    onEvent: (event: DebateEvent) => void
  ): Promise<DebateResult> {
    const emit = (event: DebateEvent) => onEvent(event);

    // Pro opening
    emit({ type: "agent_start", agentId: "pro" });
    let proTokens = "";
    const proOpening = await this.runAgent(
      "pro",
      `请就以下辩题做正方立论（支持方），200字以内：${topic}`,
      (t) => {
        proTokens += t;
        emit({ type: "token", agentId: "pro", token: t });
      }
    ).catch(() => {
      const mock = `[正方立论] 我方支持"${topic}"。人工智能的发展是人类进步的必然产物，我们应当以积极态度迎接这一变革。技术本身是中性的，关键在于如何引导和规范其发展。`;
      for (const ch of mock) emit({ type: "token", agentId: "pro", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "pro", result: proOpening });

    // Handoff pro → con
    emit({ type: "handoff", from: "pro", to: "con", message: proOpening });

    // Con opening
    emit({ type: "agent_start", agentId: "con" });
    const conOpening = await this.runAgent(
      "con",
      `请就以下辩题做反方立论（反对方），200字以内：${topic}`,
      (t) => emit({ type: "token", agentId: "con", token: t })
    ).catch(() => {
      const mock = `[反方立论] 我方反对正方观点。"${topic}"这一论断过于极端，忽视了人类智慧与技术调控的能力。历史证明，人类能够驾驭并善用每一项重大技术发明。`;
      for (const ch of mock) emit({ type: "token", agentId: "con", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "con", result: conOpening });

    // Handoff con → pro (rebuttal)
    emit({ type: "handoff", from: "con", to: "pro", message: conOpening });

    // Pro rebuttal
    emit({ type: "agent_start", agentId: "pro" });
    const proRebuttal = await this.runAgent(
      "pro",
      `反方说："${conOpening.slice(0, 200)}"，请正方进行反驳，100字以内：`,
      (t) => emit({ type: "token", agentId: "pro", token: t })
    ).catch(() => {
      const mock = `[正方反驳] 反方的论述回避了核心问题。技术的指数级发展已超出人类历史经验，我们必须正视潜在风险，未雨绸缪。`;
      for (const ch of mock) emit({ type: "token", agentId: "pro", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "pro", result: proRebuttal });

    // Handoff pro → con (rebuttal)
    emit({ type: "handoff", from: "pro", to: "con", message: proRebuttal });

    // Con rebuttal
    emit({ type: "agent_start", agentId: "con" });
    const conRebuttal = await this.runAgent(
      "con",
      `正方说："${proRebuttal.slice(0, 200)}"，请反方进行反驳，100字以内：`,
      (t) => emit({ type: "token", agentId: "con", token: t })
    ).catch(() => {
      const mock = `[反方反驳] 正方夸大了风险。国际社会已形成AI治理共识，多国政府正在建立有效的监管框架，这恰恰证明人类有能力管理AI发展。`;
      for (const ch of mock) emit({ type: "token", agentId: "con", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "con", result: conRebuttal });

    // Handoff con → main (summary)
    emit({ type: "handoff", from: "con", to: "main", message: "辩论结束，请汇总" });

    // Summary by main
    emit({ type: "agent_start", agentId: "main" });
    const summaryPrompt = `请对以下辩论进行客观汇总（100字以内）：
正方：${proOpening.slice(0, 150)}
反方：${conOpening.slice(0, 150)}
正方反驳：${proRebuttal.slice(0, 100)}
反方反驳：${conRebuttal.slice(0, 100)}`;

    const summary = await this.runAgent("main", summaryPrompt, (t) =>
      emit({ type: "token", agentId: "main", token: t })
    ).catch(() => {
      const mock = `[总结] 本次辩论中，正反双方就AI与人类命运展开了深入探讨。正方强调技术风险的现实性，反方则相信人类治理能力。双方论点均有其合理之处，AI治理需要全球协作与持续探索。`;
      for (const ch of mock) emit({ type: "token", agentId: "main", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "main", result: summary });

    emit({ type: "workflow_complete" });

    return { pro: proOpening, con: conOpening, proRebuttal, conRebuttal, summary };
  }

  async runDev(
    task: string,
    onEvent: (event: DevEvent) => void
  ): Promise<DevResult> {
    const emit = (event: DevEvent) => onEvent(event);

    // PM planning
    emit({ type: "agent_start", agentId: "pm" });
    const plan = await this.runAgent(
      "pm",
      `作为产品经理，请为以下任务制定开发计划（要点列表，100字以内）：${task}`,
      (t) => emit({ type: "token", agentId: "pm", token: t })
    ).catch(() => {
      const mock = `[PM计划]\n1. 需求分析：明确功能边界\n2. 技术选型：确定技术栈\n3. 迭代规划：分阶段交付\n4. 验收标准：定义完成条件`;
      for (const ch of mock) emit({ type: "token", agentId: "pm", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "pm", result: plan });

    emit({ type: "handoff", from: "pm", to: "dev", message: plan });

    // Dev implementation
    emit({ type: "agent_start", agentId: "dev" });
    const implementation = await this.runAgent(
      "dev",
      `根据以下计划实现代码，给出核心代码片段（100字以内）：${plan.slice(0, 200)}`,
      (t) => emit({ type: "token", agentId: "dev", token: t })
    ).catch(() => {
      const mock = `[Dev实现]\n\`\`\`typescript\n// 核心实现\nfunction solve(task: string): Promise<Result> {\n  return pipeline(task);\n}\n\`\`\``;
      for (const ch of mock) emit({ type: "token", agentId: "dev", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "dev", result: implementation });

    emit({ type: "handoff", from: "dev", to: "qa", message: implementation });

    // QA review
    emit({ type: "agent_start", agentId: "qa" });
    const review = await this.runAgent(
      "qa",
      `对以下代码进行代码审查，指出潜在问题（100字以内）：${implementation.slice(0, 200)}`,
      (t) => emit({ type: "token", agentId: "qa", token: t })
    ).catch(() => {
      const mock = `[QA审查]\n✅ 代码结构清晰\n⚠️ 缺少错误处理\n⚠️ 需要单元测试\n📝 建议添加类型注解`;
      for (const ch of mock) emit({ type: "token", agentId: "qa", token: ch });
      return mock;
    });
    emit({ type: "agent_done", agentId: "qa", result: review });

    emit({ type: "workflow_complete" });

    return { plan, implementation, review };
  }
}
