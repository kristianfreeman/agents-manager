/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  inputSchema: z.object({ city: z.string() })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * Hierarchical repository research tool
 * Uses parallel exploration and intermediate summarization to answer questions about a codebase
 */
const researchRepository = tool({
  description:
    "Research a codebase to answer a specific question using hierarchical exploration. Breaks down the question into sub-questions, explores each in parallel using GitHub tools, and synthesizes the results.",
  inputSchema: z.object({
    repository: z
      .string()
      .describe("Full repository name in format 'owner/repo'"),
    question: z
      .string()
      .describe("The research question to answer about the codebase"),
    depth: z
      .enum(["quick", "medium", "thorough"])
      .describe("How thorough the research should be")
      .default("medium")
  }),
  execute: async ({ repository, question, depth }) => {
    const { agent } = getCurrentAgent<Chat>();
    console.log(
      `[Research] Starting research on ${repository}: "${question}" (depth: ${depth})`
    );

    // Wait for MCP servers to be in "ready" state
    console.log("[Research] Waiting for MCP servers to reach 'ready' state...");
    const MAX_WAIT_MS = 15000; // 15 seconds should be plenty
    const RETRY_INTERVAL_MS = 500;
    const startTime = Date.now();
    let mcpReady = false;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      const mcpState = agent!.getMcpServers();
      const servers = mcpState.servers || {};

      // Check if we have any servers in ready state
      const serversArray = Object.values(servers);
      const readyServers = serversArray.filter((s: any) => s.state === "ready");

      console.log(
        `[Research] MCP status (${Date.now() - startTime}ms): ${readyServers.length}/${serversArray.length} servers ready`
      );

      if (readyServers.length > 0) {
        mcpReady = true;
        console.log(`[Research] MCP ready after ${Date.now() - startTime}ms`);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    }

    if (!mcpReady) {
      console.error("[Research] MCP servers failed to initialize in time");
      return {
        success: false,
        error:
          "GitHub MCP server is not available. Please ensure you're connected to GitHub in the Setup page."
      };
    }

    try {
      // 1. Decompose the question into sub-questions
      const subQuestions = decomposeQuestion(question, depth);
      console.log(
        `[Research] Decomposed into ${subQuestions.length} sub-questions:`,
        subQuestions
      );

      // 2. Parallel exploration - gather information for each sub-question
      const explorations = await Promise.all(
        subQuestions.map((sq) => exploreSubQuestion(agent!, repository, sq))
      );

      // 3. Filter out failed explorations
      const successfulExplorations = explorations.filter((e) => e.success);

      if (successfulExplorations.length === 0) {
        return {
          success: false,
          error:
            "All exploration attempts failed. The repository may not be accessible or GitHub MCP may not be connected."
        };
      }

      // 4. Aggregate results into final synthesis
      const synthesis = synthesizeResearch(question, successfulExplorations);

      console.log(
        `[Research] Research complete. Found ${successfulExplorations.length}/${subQuestions.length} successful explorations.`
      );
      console.log(`[Research] Synthesis length: ${synthesis.length} chars`);
      console.log(`[Research] Synthesis preview:`, synthesis.slice(0, 500));

      return {
        success: true,
        repository,
        question,
        synthesis,
        explorations: successfulExplorations,
        metadata: {
          subQuestionsCount: subQuestions.length,
          successfulCount: successfulExplorations.length,
          depth
        }
      };
    } catch (error) {
      console.error("[Research] Research failed:", error);
      return {
        success: false,
        error: `Research failed: ${error}`
      };
    }
  }
});

/**
 * Decomposes a research question into focused sub-questions based on depth
 */
function decomposeQuestion(
  question: string,
  depth: "quick" | "medium" | "thorough"
): string[] {
  // Start with core sub-questions common to most research
  const coreQuestions = [
    `What files and directories are most relevant to: ${question}?`,
    `What is the current implementation or pattern related to: ${question}?`
  ];

  const mediumQuestions = [
    ...coreQuestions,
    `What dependencies or libraries are used for: ${question}?`,
    `Are there any tests or documentation related to: ${question}?`
  ];

  const thoroughQuestions = [
    ...mediumQuestions,
    `What is the historical context (commits, PRs) for: ${question}?`,
    `Are there any related issues or TODOs for: ${question}?`
  ];

  switch (depth) {
    case "quick":
      return coreQuestions;
    case "medium":
      return mediumQuestions;
    case "thorough":
      return thoroughQuestions;
  }
}

/**
 * Explores a sub-question using GitHub MCP tools
 * Returns a task-specific summary based on actual file contents
 */
async function exploreSubQuestion(
  agent: Chat,
  repository: string,
  subQuestion: string
): Promise<{
  success: boolean;
  subQuestion: string;
  summary: string;
  files?: string[];
  error?: string;
}> {
  try {
    console.log(`[Research] Exploring: "${subQuestion}"`);

    // Get available GitHub MCP tools (already verified ready in main execute)
    const mcpTools = agent.mcp.getAITools();
    const toolNames = Object.keys(mcpTools);

    // Find GitHub search_code and get_file_contents tools
    const searchToolName = toolNames.find(
      (name) => name.includes("search_code") && name.includes("tool_")
    );
    const getFileToolName = toolNames.find(
      (name) => name.includes("get_file_contents") && name.includes("tool_")
    );

    if (!searchToolName) {
      return {
        success: false,
        subQuestion,
        summary: "GitHub MCP search_code tool not available",
        error: "search_code tool not found"
      };
    }

    const searchTool = mcpTools[searchToolName];
    const getFileTool = getFileToolName ? mcpTools[getFileToolName] : null;

    if (!searchTool || !searchTool.execute) {
      return {
        success: false,
        subQuestion,
        summary: "GitHub MCP search_code tool not executable",
        error: "search_code tool has no execute function"
      };
    }

    // Extract keywords from sub-question for search
    const keywords = extractKeywords(subQuestion);

    // CRITICAL: Add repo qualifier to search only the target repository
    const queryWithRepo = `${keywords.join(" ")} repo:${repository}`;
    console.log(`[Research] Searching: "${queryWithRepo}"`);

    // Search for relevant code in the specific repository
    const [owner, repo] = repository.split("/");
    const searchResults = await (searchTool as any).execute({
      query: queryWithRepo,
      owner,
      repo
    });

    console.log(
      `[Research] Search found ${searchResults?.content?.[0]?.text ? "results" : "no results"}`
    );

    // Extract file paths from search results
    const filePaths = extractFilesList(searchResults);

    if (filePaths.length === 0) {
      return {
        success: true,
        subQuestion,
        summary: `No relevant files found in ${repository} for: ${subQuestion}`,
        files: []
      };
    }

    // Level 2: Read actual file contents from top results
    let fileContents: Array<{ path: string; content: string }> = [];

    if (getFileTool) {
      console.log(
        `[Research] Reading top ${Math.min(3, filePaths.length)} files...`
      );

      // Read up to 3 most relevant files
      const filesToRead = filePaths.slice(0, 3);
      const readPromises = filesToRead.map(async (path) => {
        try {
          const result = await (getFileTool as any).execute({
            owner,
            repo,
            path
          });

          // Parse the file content from MCP response
          let content = "";
          if (result?.content?.[0]?.text) {
            const parsed = JSON.parse(result.content[0].text);
            content = parsed.content || parsed.text || "";
            // Decode base64 if needed
            if (parsed.encoding === "base64") {
              content = Buffer.from(content, "base64").toString("utf-8");
            }
          }

          return { path, content: content.slice(0, 2000) }; // Limit to first 2000 chars
        } catch (error) {
          console.error(`[Research] Failed to read ${path}:`, error);
          return null;
        }
      });

      const results = await Promise.all(readPromises);
      fileContents = results.filter(
        (r): r is { path: string; content: string } => r !== null
      );

      console.log(`[Research] Successfully read ${fileContents.length} files`);
      if (fileContents.length > 0) {
        console.log(
          `[Research] First file sample:`,
          fileContents[0].path,
          fileContents[0].content.slice(0, 200)
        );
      }
    }

    // Level 3: Summarize based on actual content
    const summary = summarizeWithContent(subQuestion, filePaths, fileContents);

    return {
      success: true,
      subQuestion,
      summary,
      files: filePaths
    };
  } catch (error) {
    console.error(`[Research] Exploration failed for "${subQuestion}":`, error);
    return {
      success: false,
      subQuestion,
      summary: `Failed to explore: ${error}`,
      error: String(error)
    };
  }
}

/**
 * Extracts relevant keywords from a question for code search
 */
function extractKeywords(question: string): string[] {
  // Remove common question words and extract meaningful terms
  const stopWords = new Set([
    "what",
    "how",
    "why",
    "where",
    "when",
    "who",
    "is",
    "are",
    "the",
    "a",
    "an",
    "for",
    "to",
    "in",
    "on",
    "at",
    "related",
    "about"
  ]);

  const words = question
    .toLowerCase()
    // Remove special characters that GitHub code search doesn't like
    .replace(/[?:,.()[\]{}]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  // Take top 3-5 keywords
  return words.slice(0, 5);
}

/**
 * Summarizes search results with actual file content analysis
 * This provides meaningful insights instead of just file lists
 */
function summarizeWithContent(
  subQuestion: string,
  filePaths: string[],
  fileContents: Array<{ path: string; content: string }>
): string {
  if (filePaths.length === 0) {
    return `No relevant files found for: ${subQuestion}`;
  }

  let summary = `Found ${filePaths.length} relevant file(s):\n`;

  // If we have actual file contents, provide detailed analysis
  if (fileContents.length > 0) {
    fileContents.forEach(({ path, content }) => {
      summary += `\n**${path}**\n`;

      // Extract meaningful snippets from the content
      const lines = content
        .split("\n")
        .filter((line) => line.trim().length > 0);

      // Look for key patterns
      const imports = lines.filter(
        (l) => l.includes("import") || l.includes("require")
      );
      const functions = lines.filter(
        (l) =>
          l.includes("function ") ||
          l.includes("const ") ||
          l.includes("class ") ||
          l.includes("interface ")
      );

      // Provide context-aware summary
      if (imports.length > 0) {
        summary += `- Dependencies: ${imports.slice(0, 2).join(", ")}\n`;
      }
      if (functions.length > 0) {
        summary += `- Key exports: ${functions
          .slice(0, 3)
          .map((f) => f.trim().slice(0, 60))
          .join(", ")}\n`;
      }

      // Add a snippet of the actual content
      const snippet = lines.slice(0, 3).join("\n").slice(0, 200);
      if (snippet) {
        summary += `- Preview: ${snippet}...\n`;
      }
    });
  } else {
    // Fallback: just list the files if we couldn't read contents
    summary += filePaths
      .slice(0, 10)
      .map((f) => `- ${f}`)
      .join("\n");
  }

  return summary;
}

/**
 * Extracts list of file paths from search results
 */
function extractFilesList(searchResults: any): string[] {
  if (!searchResults || !searchResults.items) {
    return [];
  }

  return searchResults.items
    .map((item: any) => item.path || item.name)
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Synthesizes multiple exploration results into a coherent answer
 */
function synthesizeResearch(
  question: string,
  explorations: Array<{
    subQuestion: string;
    summary: string;
    files?: string[];
  }>
): string {
  const sections = explorations.map((exp) => {
    return `**${exp.subQuestion}**\n${exp.summary}`;
  });

  const allFiles = new Set<string>();
  explorations.forEach((exp) => {
    exp.files?.forEach((file) => allFiles.add(file));
  });

  let synthesis = `# Research Results: ${question}\n\n`;
  synthesis += sections.join("\n\n");

  if (allFiles.size > 0) {
    synthesis += `\n\n## Relevant Files\n`;
    synthesis += Array.from(allFiles)
      .map((f) => `- ${f}`)
      .join("\n");
  }

  return synthesis;
}

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask,
  researchRepository
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  }
};
