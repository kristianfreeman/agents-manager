import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Tool display name mappings for common MCP and local tools
 * Provides clean, user-friendly names for frequently used tools
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // Linear tools
  list_issues: "List issues",
  update_issue: "Update issue",
  create_issue: "Create issue",
  get_issue: "Get issue",
  create_comment: "Create comment",
  list_teams: "List teams",
  get_team: "Get team",
  search_issues: "Search issues",

  // GitHub tools
  list_repositories: "List repositories",
  get_repository: "Get repository",
  create_repository: "Create repository",
  list_pull_requests: "List pull requests",
  create_pull_request: "Create pull request",
  get_pull_request: "Get pull request",
  list_commits: "List commits",
  get_commit: "Get commit",
  create_branch: "Create branch",
  get_file_contents: "Get file contents",
  search_code: "Search code",
  get_me: "Get user info",

  // Local tools
  getWeatherInformation: "Get weather",
  getLocalTime: "Get local time",
  scheduleTask: "Schedule task",
  getScheduledTasks: "Get scheduled tasks",
  cancelScheduledTask: "Cancel scheduled task"
};

/**
 * Formats tool names for display in the UI
 * Uses predefined mappings for common tools, falls back to auto-formatting
 *
 * @param toolType - The raw tool type (e.g., "tool-tool_WgV6UNht_list_issues")
 * @returns A clean, user-friendly display name (e.g., "List issues")
 */
export function getToolDisplayName(toolType: string): string {
  // Remove "tool-" prefix and MCP server ID prefix (e.g., "tool_WgV6UNht_")
  const cleanName = toolType.replace(/^tool-/, "").replace(/^tool_[^_]+_/, "");

  // Use mapping if available
  if (TOOL_DISPLAY_NAMES[cleanName]) {
    return TOOL_DISPLAY_NAMES[cleanName];
  }

  // Fallback: auto-format snake_case to Title Case
  return cleanName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
