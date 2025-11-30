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

  async executeResearch(taskData: string, _task: Schedule<string>) {
    console.log("[Research Workflow] Starting research workflow");

    try {
      // Parse the research task data
      const { repository, question, depth } = JSON.parse(taskData);
      console.log(
        `[Research Workflow] Repository: ${repository}, Question: "${question}", Depth: ${depth}`
      );

      // Get MCP tools - wait for them to be ready
      let mcpTools = {};
      const MAX_RETRIES = 10;
      const RETRY_DELAY = 1000; // 1 second

      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          mcpTools = this.mcp.getAITools();
          console.log(
            `[Research Workflow] Got MCP tools successfully (attempt ${i + 1})`
          );
          break;
        } catch (error) {
          console.log(
            `[Research Workflow] MCP tools not ready yet (attempt ${i + 1}/${MAX_RETRIES})`
          );
          if (i < MAX_RETRIES - 1) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          } else {
            throw new Error(
              "MCP tools not available after retries. Please ensure GitHub MCP server is connected."
            );
          }
        }
      }

      // Exclude researchRepository from tools to prevent recursive calls
      const { researchRepository, ...localToolsWithoutResearch } = tools;
      const allTools = {
        ...localToolsWithoutResearch,
        ...mcpTools
      };

      // Build the research prompt
      const researchPrompt = this.buildResearchPrompt(
        repository,
        question,
        depth
      );

      // Create a message with the research prompt
      const researchMessage = {
        id: generateId(),
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: researchPrompt
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      };

      // Run AI completion directly without triggering onChatMessage
      const messages = [...this.messages, researchMessage];

      console.log("[Research Workflow] Running AI completion with MCP tools...");

      const result = streamText({
        system: `You are a research assistant specialized in code exploration.

${getSchedulePrompt({ date: new Date() })}

Use the available GitHub MCP tools to thoroughly research the codebase.`,
        messages: convertToModelMessages(messages),
        model,
        tools: allTools,
        stopWhen: stepCountIs(10)
      });

      // Consume the stream and collect response
      let fullResponse = "";
      const responseParts: Array<{
        type: string;
        text?: string;
        toolName?: string;
      }> = [];
      const stream = result.toUIMessageStream();

      for await (const chunk of stream) {
        console.log(`[Research Workflow] Stream chunk type: ${chunk.type}`);

        if (chunk.type === "text") {
          fullResponse += chunk.text;
          responseParts.push({ type: "text", text: chunk.text });
        } else if (chunk.type === "tool-call") {
          console.log(`[Research Workflow] Tool call: ${chunk.toolName}`);
          responseParts.push({ type: "tool-call", toolName: chunk.toolName });
        } else if (chunk.type === "tool-result") {
          console.log(
            `[Research Workflow] Tool result: ${JSON.stringify(chunk).slice(0, 200)}`
          );
        }
      }

      console.log(
        `[Research Workflow] AI completion finished, response length: ${fullResponse.length}, parts: ${responseParts.length}`
      );

      // Save both the prompt and response to conversation
      await this.saveMessages([
        ...messages,
        {
          id: generateId(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: fullResponse
            }
          ],
          metadata: {
            createdAt: new Date()
          }
        }
      ]);

      console.log("[Research Workflow] Research completed and saved");
    } catch (error) {
      console.error("[Research Workflow] Failed to execute research:", error);

      // Add error message to conversation
      await this.saveMessages([
        ...this.messages,
        {
          id: generateId(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Research workflow failed: ${error}`
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
   * Builds a research prompt based on the depth level
   * The AI will use MCP tools to explore the codebase and provide insights
   */
  private buildResearchPrompt(
    repository: string,
    question: string,
    depth: "quick" | "medium" | "thorough"
  ): string {
    const depthInstructions = {
      quick: `Research the following question about ${repository}:

Question: ${question}

INSTRUCTIONS:
1. Use search_code to find relevant files (try multiple search terms if needed)
2. Use get_file_contents to read the most relevant files you find
3. Provide a concise summary with specific code examples
4. Be autonomous - don't ask the user what to do next, just explore and report findings
5. If initial searches don't work, try alternative keywords related to the question`,

      medium: `Research the following question about ${repository}:

Question: ${question}

INSTRUCTIONS:
1. Search for relevant files using multiple related keywords
2. Read actual file contents from top search results (at least 3-5 files)
3. Look for:
   - Main implementation files
   - Configuration and setup code
   - Related tests or examples
   - Documentation (README, docs folders)
4. Extract and show specific code examples
5. Explain the implementation patterns you find
6. Be thorough and autonomous - explore multiple angles without asking for guidance
7. If initial searches fail, try broader or more specific terms`,

      thorough: `Research the following question about ${repository}:

Question: ${question}

INSTRUCTIONS:
1. Conduct comprehensive exploration using multiple search strategies:
   - Direct keyword searches
   - Related terminology searches
   - Common file names (e.g., auth.ts, config.ts, README.md)
2. Read 5-10 relevant files minimum, including:
   - Core implementation files
   - Configuration files
   - Tests and examples
   - Documentation
3. Analyze:
   - Implementation patterns and architecture
   - Dependencies and libraries used
   - API design and interfaces
   - Error handling and edge cases
4. Provide detailed code examples with explanations
5. Work autonomously - try multiple approaches, don't ask user for next steps
6. If you don't find direct matches, explore related areas and infer from context`
    };

    return depthInstructions[depth];
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
