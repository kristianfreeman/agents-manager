import { routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt } from "agents/schedule";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
// import { env } from "cloudflare:workers";

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handle HTTP requests for MCP server management and other agent operations
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Get MCP servers state
    if (url.pathname.endsWith("/mcp-servers") && request.method === "GET") {
      const mcpState = this.getMcpServers();
      return new Response(JSON.stringify(mcpState, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Add MCP server
    if (url.pathname.endsWith("/mcp-servers") && request.method === "POST") {
      const { serverUrl, name, authToken } = (await request.json()) as {
        serverUrl: string;
        name: string;
        authToken?: string;
      };

      console.log(`[MCP] Connecting to ${name} at ${serverUrl}`);
      console.log(`[MCP] Auth token provided: ${authToken ? "YES (length: " + authToken.length + ")" : "NO"}`);

      // If authToken provided, use it in headers (for PAT-based auth)
      const options = authToken
        ? {
            transport: {
              headers: {
                Authorization: `Bearer ${authToken}`
              }
            }
          }
        : undefined;

      console.log(`[MCP] Options:`, JSON.stringify(options, null, 2));

      try {
        const { id, authUrl } = await this.addMcpServer(
          name,
          serverUrl,
          undefined,
          undefined,
          options
        );

        console.log(`[MCP] Connection result - ID: ${id}, authUrl: ${authUrl || "none"}`);

        if (authUrl) {
          return new Response(
            JSON.stringify({ serverId: id, authUrl }),
            { headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ serverId: id, status: "connected" }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error(`[MCP] Failed to connect to ${name}:`, error);
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Remove MCP server
    if (
      url.pathname.match(/\/mcp-servers\/(.+)$/) &&
      request.method === "DELETE"
    ) {
      const serverId = url.pathname.split("/").pop()!;
      await this.removeMcpServer(serverId);
      return new Response(JSON.stringify({ status: "removed" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Get assigned tasks from Linear MCP
    if (url.pathname.endsWith("/tasks") && request.method === "GET") {
      try {
        // Check MCP server state
        const mcpState = this.getMcpServers();
        console.log("[Linear] MCP State:", JSON.stringify(mcpState, null, 2));

        // Find Linear server
        const servers = mcpState.servers || {};
        const linearServer = Object.values(servers).find(
          (s: any) => s.name === "Linear"
        );

        if (!linearServer) {
          console.log("[Linear] Linear server not connected");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("[Linear] Server state:", (linearServer as any).state);

        // If server is not ready yet, return empty array
        if ((linearServer as any).state !== "ready") {
          console.log("[Linear] Server not ready yet, state:", (linearServer as any).state);
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const tools = this.mcp.getAITools();
        const toolNames = Object.keys(tools);
        console.log("[Linear] Available MCP tools:", toolNames);

        // Find the Linear issues list tool
        const issuesListTool = toolNames.find(name =>
          name.includes('linear') && (name.includes('issues') || name.includes('issue')) && name.includes('list')
        );

        if (!issuesListTool) {
          console.error("[Linear] No issues list tool found. Available tools:", toolNames);
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("[Linear] Using tool:", issuesListTool);

        // Query Linear MCP for issues assigned to the current user
        const result = await this.mcp.callTool(issuesListTool, {
          filter: {
            assignee: { id: { eq: "me" } },
            state: { type: { in: ["started", "unstarted"] } }
          }
        });

        console.log("[Linear] Raw MCP response:", JSON.stringify(result, null, 2));

        // Transform Linear issues to our task format
        const issues = result.issues || [];
        const tasks = issues.map((issue: any) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          url: issue.url,
          claimedAt: issue.createdAt,
          researchStatus: "pending" as const
        }));

        return new Response(JSON.stringify(tasks), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        console.error("[Linear] Failed to fetch tasks:", error);
        // Return empty array on error rather than failing
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Let base class handle other requests (chat, websocket, etc.)
    const response = await super.onRequest?.(request);
    if (!response) {
      return new Response("Not Found", { status: 404 });
    }
    return response;
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a helpful assistant that can do various tasks... 

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }

    // Debug: Check which bindings are available
    if (url.pathname === "/debug-bindings") {
      return Response.json({
        hasChat: !!env.Chat,
        hasTaskManager: !!env.TaskManager,
        hasASSETS: !!env.ASSETS,
        hasAI: !!env.AI,
        envKeys: Object.keys(env)
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }

    // Try to route to agent first
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Fall back to static assets (SPA mode handles 404s)
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
