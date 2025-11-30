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
    console.log(
      `[Research] Starting research on ${repository}: "${question}" (depth: ${depth})`
    );

    // Build research instructions based on depth
    const depthInstructions = {
      quick: `I'll research this question quickly by:
1. Searching for relevant files using GitHub code search
2. Reading 2-3 key files
3. Providing a concise summary

Let me explore the ${repository} repository now...`,

      medium: `I'll conduct a moderate-depth research by:
1. Searching for relevant files using multiple keywords
2. Reading 3-5 key implementation files
3. Examining configuration, tests, and documentation
4. Providing a comprehensive summary with code examples

Let me explore the ${repository} repository now...`,

      thorough: `I'll conduct thorough research by:
1. Using multiple search strategies to find all relevant files
2. Reading 5-10 files including implementation, config, tests, and docs
3. Analyzing architecture, patterns, dependencies, and API design
4. Providing detailed analysis with code examples

Let me deeply explore the ${repository} repository now...`
    };

    // Return instructions that guide the AI to research
    // The AI will naturally use MCP tools in the ongoing conversation
    return {
      success: true,
      message: depthInstructions[depth],
      repository,
      question,
      depth,
      instructions:
        "Use GitHub MCP tools (search_code, get_file_contents) to research this question thoroughly. Be autonomous and don't ask for guidance - explore multiple approaches if needed."
    };
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
