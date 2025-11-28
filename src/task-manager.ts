import { Agent } from "agents";

/**
 * TaskManager Agent
 * Orchestrates AI-powered research for Linear tasks using MCP tools
 * Linear is the source of truth for task state (assignments, status, etc.)
 */
export class TaskManager extends Agent<Env> {
  /**
   * Handle HTTP requests for task research and operations
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Trigger research for a Linear task
    if (
      url.pathname.match(/\/research\/(.+)$/) &&
      request.method === "POST"
    ) {
      const taskId = url.pathname.split("/").pop()!;
      const research = await this.runResearch(taskId);
      return new Response(JSON.stringify(research, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Run AI-powered research for a task
   * Uses Linear MCP to get task details and GitHub MCP to search code
   */
  private async runResearch(taskId: string) {
    // TODO: Implement research orchestration
    // 1. Get task details from Linear MCP
    // 2. Use Chat agent with MCP tools to:
    //    - Search codebase for relevant files (GitHub MCP)
    //    - Find similar Linear issues (Linear MCP)
    //    - Create a git branch (GitHub MCP)
    // 3. Return or post results as Linear comment

    return {
      taskId,
      status: "research_pending",
      message:
        "Research orchestration not yet implemented. Will use Linear + GitHub MCP tools via Chat agent."
    };
  }
}
