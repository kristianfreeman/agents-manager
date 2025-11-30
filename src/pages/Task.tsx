import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Streamdown } from "streamdown";
import { ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@/components/button/Button";

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
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTask();
  }, [id]);

  const fetchTask = async () => {
    try {
      // Fetch from both my-tasks and all tasks
      const [myTasksRes, allTasksRes] = await Promise.all([
        fetch("/agents/chat/default/my-tasks"),
        fetch("/agents/chat/default/tasks")
      ]);

      const myTasks = myTasksRes.ok
        ? ((await myTasksRes.json()) as TaskDetails[])
        : [];
      const allTasks = allTasksRes.ok
        ? ((await allTasksRes.json()) as TaskDetails[])
        : [];

      const allTasksList = [...myTasks, ...allTasks];
      const foundTask = allTasksList.find((t) => t.id === id);
      setTask(foundTask || null);
    } catch (error) {
      console.error("Failed to fetch task:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
          Loading task...
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="mb-4"
        >
          <ArrowLeft size={16} />
          Back to tasks
        </Button>
        <div className="text-center py-12 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
          <p className="text-neutral-600 dark:text-neutral-400">
            Task not found
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/")}
        className="mb-4"
      >
        <ArrowLeft size={16} />
        Back
      </Button>

      <div className="bg-white dark:bg-neutral-900 p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div className="mb-4">
          <h1 className="text-xl font-bold mb-2">{task.title}</h1>
          <a
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#F48120] hover:underline text-sm"
          >
            View in Linear →
          </a>
        </div>

        {task.description && (
          <div className="mt-4">
            <h2 className="text-base font-semibold mb-2">Description</h2>
            <div className="markdown-body text-neutral-600 dark:text-neutral-400 text-sm">
              <Streamdown>{task.description}</Streamdown>
            </div>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                Status
              </p>
              <p className="text-sm font-medium capitalize">
                {task.researchStatus}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                Claimed At
              </p>
              <p className="text-sm font-medium">
                {new Date(task.claimedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
