import { Link } from "react-router-dom";
import { useState, useEffect } from "react";

interface ClaimedTask {
  id: string;
  title: string;
  description?: string;
  url: string;
  claimedAt: string;
  researchStatus: "pending" | "in_progress" | "completed" | "failed";
}

interface McpServer {
  id: string;
  name: string;
  state: "authenticating" | "connecting" | "ready" | "discovering" | "failed";
}

export default function TaskList() {
  const [myTasks, setMyTasks] = useState<ClaimedTask[]>([]);
  const [allTasks, setAllTasks] = useState<ClaimedTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [linearConnected, setLinearConnected] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();

    // Listen for Linear updates from chat
    const handleLinearUpdate = () => {
      console.log("[TaskList] Linear update detected, refreshing tasks...");
      fetchData();
    };

    window.addEventListener("linear-updated", handleLinearUpdate);

    return () => {
      window.removeEventListener("linear-updated", handleLinearUpdate);
    };
  }, []);

  const fetchData = async () => {
    await Promise.all([
      fetchMyTasks(),
      fetchAllTasks(),
      checkLinearConnection()
    ]);
  };

  const checkLinearConnection = async () => {
    try {
      const response = await fetch("/agents/chat/default/mcp-servers");
      if (response.ok) {
        const data = (await response.json()) as {
          servers?: Record<string, McpServer> | McpServer[];
        };

        let serversArray: McpServer[] = [];
        if (data.servers) {
          if (Array.isArray(data.servers)) {
            serversArray = data.servers;
          } else {
            serversArray = Object.entries(data.servers).map(([id, server]) => ({
              ...server,
              id: server.id || id
            }));
          }
        }

        const linear = serversArray.find((s) => s.name === "Linear");
        setLinearConnected(linear?.state === "ready");
      }
    } catch (error) {
      console.error("Failed to check Linear connection:", error);
    }
  };

  const fetchMyTasks = async () => {
    try {
      const response = await fetch("/agents/chat/default/my-tasks");
      if (response.ok) {
        const data = (await response.json()) as ClaimedTask[];
        setMyTasks(data);
        setTasksError(null);
      } else {
        const errorData = await response.json();
        setTasksError(errorData.error || "Failed to fetch tasks");
        setMyTasks([]);
      }
    } catch (error) {
      console.error("Failed to fetch my tasks:", error);
      setTasksError("Network error - could not connect to server");
      setMyTasks([]);
    }
  };

  const fetchAllTasks = async () => {
    try {
      const response = await fetch("/agents/chat/default/tasks");
      if (response.ok) {
        const data = (await response.json()) as ClaimedTask[];
        setAllTasks(data);
        setTasksError(null);
      } else {
        const errorData = await response.json();
        setTasksError(errorData.error || "Failed to fetch tasks");
        setAllTasks([]);
      }
    } catch (error) {
      console.error("Failed to fetch all tasks:", error);
      setTasksError("Network error - could not connect to server");
      setAllTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  return (
    <div className="p-6">
      {/* Error Banner */}
      {tasksError && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium">
            {tasksError}
          </p>
          <p className="text-xs text-red-600 dark:text-red-300 mt-1">
            Check that Linear MCP server is connected and running in Setup.
          </p>
        </div>
      )}

      {/* My Tasks Section */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3">My Tasks</h2>
        {tasksLoading ? (
          <div className="text-center py-8 text-neutral-600 dark:text-neutral-400 text-sm">
            Loading tasks...
          </div>
        ) : myTasks.length === 0 ? (
          <div className="text-center py-8 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-2">
              No tasks assigned to you
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-500">
              {linearConnected
                ? "You don't have any assigned tasks in Linear"
                : "Connect Linear in Setup to start claiming tasks"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {myTasks.map((task) => (
              <Link
                key={task.id}
                to={`/${task.id}`}
                className="bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-850 transition-colors cursor-pointer block"
              >
                <h3 className="font-medium text-sm">{task.title}</h3>
                <span className="text-[#F48120] text-xs whitespace-nowrap ml-4">
                  →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* All Tasks Section */}
      <div>
        <h2 className="text-lg font-semibold mb-3">All Tasks</h2>
        {tasksLoading ? (
          <div className="text-center py-8 text-neutral-600 dark:text-neutral-400 text-sm">
            Loading tasks...
          </div>
        ) : (
          (() => {
            // Filter out tasks that are already in "My Tasks"
            const myTaskIds = new Set(myTasks.map((task) => task.id));
            const unassignedTasks = allTasks.filter(
              (task) => !myTaskIds.has(task.id)
            );

            return unassignedTasks.length === 0 ? (
              <div className="text-center py-8 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
                <p className="text-neutral-600 dark:text-neutral-400 text-sm">
                  No unassigned tasks available
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {unassignedTasks.map((task) => (
                  <Link
                    key={task.id}
                    to={`/${task.id}`}
                    className="bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-850 transition-colors cursor-pointer block"
                  >
                    <h3 className="font-medium text-sm">{task.title}</h3>
                    <span className="text-[#F48120] text-xs whitespace-nowrap ml-4">
                      →
                    </span>
                  </Link>
                ))}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
