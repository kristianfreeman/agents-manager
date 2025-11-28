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

export default function Home() {
  const [myTasks, setMyTasks] = useState<ClaimedTask[]>([]);
  const [allTasks, setAllTasks] = useState<ClaimedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [linearConnected, setLinearConnected] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    await Promise.all([fetchMyTasks(), fetchAllTasks(), checkLinearConnection()]);
  };

  const checkLinearConnection = async () => {
    try {
      const response = await fetch("/agents/chat/default/mcp-servers");
      if (response.ok) {
        const data = (await response.json()) as {
          servers?: Record<string, McpServer> | McpServer[];
        };

        // Convert servers object to array if needed
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

        // Check if Linear is connected and ready
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
      }
    } catch (error) {
      console.error("Failed to fetch my tasks:", error);
    }
  };

  const fetchAllTasks = async () => {
    try {
      const response = await fetch("/agents/chat/default/tasks");
      if (response.ok) {
        const data = (await response.json()) as ClaimedTask[];
        setAllTasks(data);
      }
    } catch (error) {
      console.error("Failed to fetch all tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Task Manager</h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              AI-powered task research and development workflow
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/setup"
              className="inline-block bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              Setup MCP
            </Link>
            <Link
              to="/chat"
              className="inline-block bg-[#F48120] hover:bg-[#F48120]/90 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              AI Chat
            </Link>
          </div>
        </div>

        <div className="grid gap-6">
          {/* My Tasks Section */}
          <div>
            <h2 className="text-2xl font-semibold mb-4">My Tasks</h2>
            {loading ? (
              <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
                Loading tasks...
              </div>
            ) : myTasks.length === 0 ? (
              <div className="text-center py-12 bg-neutral-100 dark:bg-neutral-900 rounded-lg">
                <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                  No tasks assigned to you
                </p>
                <p className="text-sm text-neutral-500 dark:text-neutral-500">
                  {linearConnected
                    ? "You don't have any assigned tasks in Linear"
                    : "Connect Linear in Setup to start claiming tasks"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {myTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                  >
                    <h3 className="font-medium">{task.title}</h3>
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#F48120] hover:underline text-sm whitespace-nowrap ml-4"
                    >
                      View →
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Tasks Section */}
          <div>
            <h2 className="text-2xl font-semibold mb-4">All Tasks</h2>
            {loading ? (
              <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
                Loading tasks...
              </div>
            ) : allTasks.length === 0 ? (
              <div className="text-center py-12 bg-neutral-100 dark:bg-neutral-900 rounded-lg">
                <p className="text-neutral-600 dark:text-neutral-400">
                  No tasks available
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {allTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                  >
                    <h3 className="font-medium">{task.title}</h3>
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#F48120] hover:underline text-sm whitespace-nowrap ml-4"
                    >
                      View →
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
