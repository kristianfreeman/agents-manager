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
      console.log(
        `[MCP] Auth token provided: ${authToken ? `YES (length: ${authToken.length})` : "NO"}`
      );

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

        console.log(
          `[MCP] Connection result - ID: ${id}, authUrl: ${authUrl || "none"}`
        );

        if (authUrl) {
          return new Response(JSON.stringify({ serverId: id, authUrl }), {
            headers: { "Content-Type": "application/json" }
          });
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

    // Get my assigned tasks from Linear MCP
    if (url.pathname.endsWith("/my-tasks") && request.method === "GET") {
      try {
        // Check MCP server state
        const mcpState = this.getMcpServers();
        console.log("[Linear] MCP State:", JSON.stringify(mcpState, null, 2));

        // Find Linear server
        const servers = mcpState.servers || {};
        const linearServerEntry = Object.entries(servers).find(
          ([_id, s]: [string, any]) => s.name === "Linear"
        );

        if (!linearServerEntry) {
          console.log("[Linear] Linear server not connected");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const [linearServerId, linearServer] = linearServerEntry;
        console.log("[Linear] Server state:", (linearServer as any).state);

        // If server is not ready yet, return empty array
        if ((linearServer as any).state !== "ready") {
          console.log(
            "[Linear] Server not ready yet, state:",
            (linearServer as any).state
          );
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const tools = this.mcp.getAITools();
        const toolNames = Object.keys(tools);
        console.log("[Linear] Available MCP tools:", toolNames);
        console.log("[Linear] Server ID:", linearServerId);

        // Find the Linear issues list tool - it has format: tool_{serverId}_list_issues
        const issuesListTool = toolNames.find((name) =>
          name.includes(`tool_${linearServerId}_list_issues`)
        );

        if (!issuesListTool) {
          console.error(
            "[Linear] No issues list tool found for server",
            linearServerId
          );
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("[Linear] Using tool:", issuesListTool);

        // Get the actual tool object and execute it directly
        const tool = tools[issuesListTool];
        if (!tool || !tool.execute) {
          console.error("[Linear] Tool doesn't have execute function");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        // Query Linear MCP for issues assigned to the current user
        const filterParams = {
          filter: {
            assignee: { id: { eq: "me" } },
            state: { type: { in: ["started", "unstarted", "backlog"] } }
          }
        };
        console.log(
          "[Linear] Filter params for my-tasks:",
          JSON.stringify(filterParams, null, 2)
        );
        const result = await tool.execute(filterParams);

        console.log(
          "[Linear] Raw MCP response:",
          JSON.stringify(result, null, 2)
        );

        // MCP tools return results in content array format
        // Parse the actual data from the text content
        let issues = [];
        if ((result as any).content && Array.isArray((result as any).content)) {
          const textContent = (result as any).content.find(
            (c: any) => c.type === "text"
          );
          if (textContent && textContent.text) {
            try {
              issues = JSON.parse(textContent.text);
              console.log("[Linear] Parsed my issues:", issues.length);
              if (issues.length > 0) {
                console.log("[Linear] Sample issue state:", {
                  title: issues[0].title,
                  state: issues[0].state,
                  stateType: issues[0].state?.type
                });
              }
            } catch (e) {
              console.error("[Linear] Failed to parse issues JSON:", e);
            }
          }
        }

        // Filter client-side for issues that actually have an assignee and aren't completed
        // (Linear MCP server doesn't always respect filters)
        const assignedIssues = issues.filter((issue: any) => {
          const hasAssignee = issue.assigneeId;
          const notDone =
            issue.status !== "Done" && issue.status !== "Canceled";
          return hasAssignee && notDone;
        });
        console.log(
          "[Linear] Filtered to assigned, active issues:",
          assignedIssues.length,
          "from",
          issues.length
        );

        // Transform Linear issues to our task format
        const tasks = assignedIssues.map((issue: any) => ({
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
        console.error("[Linear] Failed to fetch my tasks:", error);
        return new Response(
          JSON.stringify({
            error:
              "Failed to fetch tasks from Linear. The Linear MCP server may be unavailable.",
            details: error instanceof Error ? error.message : String(error)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    }

    // Get repositories from GitHub MCP
    if (url.pathname.endsWith("/repositories") && request.method === "GET") {
      try {
        const mcpState = this.getMcpServers();
        const servers = mcpState.servers || {};
        const githubServer = Object.values(servers).find(
          (s: any) => s.name === "GitHub"
        );

        if (!githubServer || (githubServer as any).state !== "ready") {
          console.log("[GitHub] GitHub server not connected or not ready");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const tools = this.mcp.getAITools();
        const toolNames = Object.keys(tools);
        console.log("[GitHub] Available MCP tools:", toolNames);

        // First get authenticated user
        const getMeTool = toolNames.find((name) => name.includes("get_me"));
        if (!getMeTool) {
          console.error("[GitHub] No get_me tool found");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("[GitHub] Getting authenticated user...");
        const meResult = await tools[getMeTool].execute({});
        console.log("[GitHub] User result:", JSON.stringify(meResult, null, 2));

        // Parse username from result
        let username = null;
        if (
          (meResult as any).content &&
          Array.isArray((meResult as any).content)
        ) {
          const textContent = (meResult as any).content.find(
            (c: any) => c.type === "text"
          );
          if (textContent && textContent.text) {
            try {
              const userData = JSON.parse(textContent.text);
              username = userData.login;
              console.log("[GitHub] Authenticated as:", username);
            } catch (e) {
              console.error("[GitHub] Failed to parse user data:", e);
            }
          }
        }

        if (!username) {
          console.error("[GitHub] Could not get username");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        // Now search for user's repositories
        const searchReposTool = toolNames.find((name) =>
          name.includes("search_repositories")
        );
        if (!searchReposTool) {
          console.error("[GitHub] No search_repositories tool found");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("[GitHub] Searching repositories for user:", username);
        const result = await tools[searchReposTool].execute({
          query: `user:${username}`
        });
        console.log(
          "[GitHub] Raw MCP response:",
          JSON.stringify(result, null, 2)
        );

        // Parse MCP response
        let repositories = [];
        if ((result as any).content && Array.isArray((result as any).content)) {
          const textContent = (result as any).content.find(
            (c: any) => c.type === "text"
          );
          if (textContent && textContent.text) {
            try {
              const searchResult = JSON.parse(textContent.text);
              // GitHub search returns items array
              repositories = searchResult.items || searchResult;
              console.log("[GitHub] Parsed repositories:", repositories.length);
            } catch (e) {
              console.error("[GitHub] Failed to parse repositories JSON:", e);
            }
          }
        }

        return new Response(JSON.stringify(repositories), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        console.error("[GitHub] Failed to fetch repositories:", error);
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Get all tasks from Linear MCP
    if (url.pathname.endsWith("/tasks") && request.method === "GET") {
      try {
        // Check MCP server state
        const mcpState = this.getMcpServers();
        console.log("[Linear] MCP State:", JSON.stringify(mcpState, null, 2));

        // Find Linear server
        const servers = mcpState.servers || {};
        const linearServerEntry = Object.entries(servers).find(
          ([_id, s]: [string, any]) => s.name === "Linear"
        );

        if (!linearServerEntry) {
          console.log("[Linear] Linear server not connected");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const [linearServerId, linearServer] = linearServerEntry;
        console.log("[Linear] Server state:", (linearServer as any).state);

        // If server is not ready yet, return empty array
        if ((linearServer as any).state !== "ready") {
          console.log(
            "[Linear] Server not ready yet, state:",
            (linearServer as any).state
          );
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const tools = this.mcp.getAITools();
        const toolNames = Object.keys(tools);
        console.log("[Linear] Available MCP tools:", toolNames);
        console.log("[Linear] Server ID:", linearServerId);

        // Find the Linear issues list tool - it has format: tool_{serverId}_list_issues
        const issuesListTool = toolNames.find((name) =>
          name.includes(`tool_${linearServerId}_list_issues`)
        );

        if (!issuesListTool) {
          console.error(
            "[Linear] No issues list tool found for server",
            linearServerId
          );
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("[Linear] Using tool:", issuesListTool);

        // Get the actual tool object and execute it directly
        const tool = tools[issuesListTool];
        if (!tool || !tool.execute) {
          console.error("[Linear] Tool doesn't have execute function");
          return new Response(JSON.stringify([]), {
            headers: { "Content-Type": "application/json" }
          });
        }

        // Query Linear MCP for all issues
        const result = await tool.execute({
          filter: {
            state: { type: { in: ["started", "unstarted", "backlog"] } }
          }
        });

        console.log(
          "[Linear] Raw MCP response:",
          JSON.stringify(result, null, 2)
        );

        // MCP tools return results in content array format
        // Parse the actual data from the text content
        let issues = [];
        if ((result as any).content && Array.isArray((result as any).content)) {
          const textContent = (result as any).content.find(
            (c: any) => c.type === "text"
          );
          if (textContent && textContent.text) {
            try {
              issues = JSON.parse(textContent.text);
              console.log("[Linear] Parsed all issues:", issues.length);
            } catch (e) {
              console.error("[Linear] Failed to parse issues JSON:", e);
            }
          }
        }

        // Filter client-side to exclude completed/canceled issues
        const activeIssues = issues.filter((issue: any) => {
          const notDone =
            issue.status !== "Done" && issue.status !== "Canceled";
          return notDone;
        });
        console.log(
          "[Linear] Filtered to active issues:",
          activeIssues.length,
          "from",
          issues.length
        );

        // Transform Linear issues to our task format
        const tasks = activeIssues.map((issue: any) => ({
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
        return new Response(
          JSON.stringify({
            error:
              "Failed to fetch tasks from Linear. The Linear MCP server may be unavailable.",
            details: error instanceof Error ? error.message : String(error)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
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
    // Safely get MCP tools, handling the case where MCP servers are still initializing
    let mcpTools = {};
    try {
      mcpTools = this.mcp.getAITools();
    } catch (error) {
      console.warn("[Chat] MCP tools not yet available:", error);
    }

    const allTools = {
      ...tools,
      ...mcpTools
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

        // Extract repository context from the latest message metadata
        const latestMessage = processedMessages[processedMessages.length - 1];
        const repositoryContext = latestMessage?.metadata?.repository;

        // Build dynamic system prompt with repository context
        let systemPrompt = `You are a helpful assistant that can do various tasks...

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.`;

        if (repositoryContext) {
          systemPrompt += `

REPOSITORY CONTEXT:
You are currently working in the repository: ${repositoryContext.full_name}
Owner: ${repositoryContext.owner}
Repository: ${repositoryContext.name}

All code-related questions, file searches, and development tasks should be scoped to this repository.
When using GitHub MCP tools, always reference this repository context.`;
        }

        const result = streamText({
          system: systemPrompt,

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
