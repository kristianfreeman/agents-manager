import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";

interface TaskDetails {
  id: string;
  title: string;
  description?: string;
  url: string;
  claimedAt: string;
  researchStatus: "pending" | "in_progress" | "completed" | "failed";
}

export default function Task() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTask();
  }, [id]);

  const fetchTask = async () => {
    try {
      // For now, we'll fetch from the my-tasks endpoint and find the matching task
      // TODO: Create a dedicated endpoint for getting a single task by ID
      const response = await fetch("/agents/chat/default/my-tasks");
      if (response.ok) {
        const tasks = (await response.json()) as TaskDetails[];
        const foundTask = tasks.find((t) => t.id === id);
        setTask(foundTask || null);
      }
    } catch (error) {
      console.error("Failed to fetch task:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
            Loading task...
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <Link
            to="/"
            className="text-[#F48120] hover:underline mb-6 inline-block"
          >
            ← Back to tasks
          </Link>
          <div className="text-center py-12 bg-neutral-100 dark:bg-neutral-900 rounded-lg">
            <p className="text-neutral-600 dark:text-neutral-400">
              Task not found
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          to="/"
          className="text-[#F48120] hover:underline mb-6 inline-block"
        >
          ← Back to tasks
        </Link>

        <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-start justify-between mb-4">
            <h1 className="text-3xl font-bold">{task.title}</h1>
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#F48120] hover:underline text-sm whitespace-nowrap ml-4"
            >
              View in Linear →
            </a>
          </div>

          {task.description && (
            <div className="mt-4">
              <h2 className="text-lg font-semibold mb-2">Description</h2>
              <p className="text-neutral-600 dark:text-neutral-400">
                {task.description}
              </p>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-neutral-500 dark:text-neutral-500">
                  Status
                </p>
                <p className="font-medium capitalize">{task.researchStatus}</p>
              </div>
              <div>
                <p className="text-sm text-neutral-500 dark:text-neutral-500">
                  Claimed At
                </p>
                <p className="font-medium">
                  {new Date(task.claimedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
