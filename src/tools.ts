/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet, generateId } from "ai";
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
 * Runs as an async background workflow - results appear in chat automatically
 * Optionally posts results as a comment to a Linear task
 */
const researchRepository = tool({
  description:
    "Start a background research workflow to explore a GitHub repository and answer questions about the codebase. IMPORTANT: This runs asynchronously - results will appear in the chat automatically when complete. Do NOT call this tool multiple times for the same question. Only call once per research request. If a repository is selected in the current context, you don't need to specify it. Optionally provide a Linear task ID to post results as a comment on that task.",
  inputSchema: z.object({
    repository: z
      .string()
      .optional()
      .describe(
        "Full repository name in format 'owner/repo'. Optional if a repository is already selected in the chat context."
      ),
    question: z
      .string()
      .describe("The research question to answer about the codebase"),
    depth: z
      .enum(["quick", "medium", "thorough"])
      .describe("How thorough the research should be")
      .default("medium"),
    linearTaskId: z
      .string()
      .optional()
      .describe(
        "Optional Linear task/issue ID (e.g., 'ABC-123' or UUID). If provided, research results will be posted as a comment on that task."
      )
  }),
  execute: async ({ repository, question, depth, linearTaskId }) => {
    const { agent } = getCurrentAgent<Chat>();

    // If no repository specified, try to get it from the chat context
    let resolvedRepo = repository;
    if (!resolvedRepo) {
      const messages = agent!.messages;
      // Look for repository context in recent messages (check last 10)
      for (let i = messages.length - 1; i >= Math.max(0, messages.length - 10); i--) {
        const msg = messages[i];
        const repoContext = (msg.metadata as any)?.repository;
        if (repoContext?.full_name) {
          resolvedRepo = repoContext.full_name;
          console.log(`[Research] Using repository from context: ${resolvedRepo}`);
          break;
        }
      }
    }

    if (!resolvedRepo) {
      return "No repository specified and none found in chat context. Please specify a repository in format 'owner/repo' or select one first.";
    }

    console.log(
      `[Research] Creating research workflow for ${resolvedRepo}: "${question}" (depth: ${depth})${linearTaskId ? ` [Linear: ${linearTaskId}]` : ""}`
    );

    try {
      const workflowId = generateId();

      // Create workflow record and schedule it
      await agent!.createResearchWorkflow(
        workflowId,
        resolvedRepo,
        question,
        depth,
        linearTaskId
      );

      console.log(`[Research] Created workflow: ${workflowId}`);

      // Return clear message that research is happening in background
      const linearNote = linearTaskId
        ? ` Results will also be posted as a comment on Linear task ${linearTaskId}.`
        : "";
      return `Research workflow started for ${resolvedRepo}.${linearNote} The results will appear automatically in this chat when complete. No further action needed - please wait for the results to appear.`;
    } catch (error) {
      console.error("[Research] Failed to create research workflow:", error);
      return `Failed to start research: ${error}. Please check that the GitHub MCP server is connected.`;
    }
  }
});

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
