import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Streamdown } from "streamdown";
import { ArrowLeft, CalendarBlank, User, Tag, Flag } from "@phosphor-icons/react";
import { Button } from "@/components/button/Button";

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    displayName?: string;
  };
}

interface Label {
  id: string;
  name: string;
  color?: string;
}

interface TaskDetails {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  status?: string;
  state?: {
    name: string;
    type: string;
    color?: string;
  };
  priority?: number;
  priorityLabel?: string;
  labels?: Label[];
  assignee?: {
    id: string;
    name: string;
    displayName?: string;
  };
  comments?: Comment[];
}

const priorityLabels: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low"
};

const priorityColors: Record<number, string> = {
  0: "text-neutral-500",
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-yellow-600 dark:text-yellow-500",
  4: "text-blue-500"
};

export default function Task() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchTask();
    }
  }, [id]);

  const fetchTask = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/agents/chat/default/tasks/${id}`);

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || `Failed to fetch task (${response.status})`);
      }

      const data = (await response.json()) as TaskDetails;
      setTask(data);
    } catch (err) {
      console.error("Failed to fetch task:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch task");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
          Loading task...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="mb-4"
        >
          <ArrowLeft size={16} />
          Back to tasks
        </Button>
        <div className="text-center py-12">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchTask} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="mb-4"
        >
          <ArrowLeft size={16} />
          Back to tasks
        </Button>
        <div className="text-center py-12">
          <p className="text-neutral-600 dark:text-neutral-400">
            Task not found
          </p>
        </div>
      </div>
    );
  }

  const priorityValue = task.priority ?? 0;
  const priorityLabel = task.priorityLabel || priorityLabels[priorityValue] || "Unknown";
  const priorityColor = priorityColors[priorityValue] || "text-neutral-500";

  return (
    <div className="p-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/")}
        className="mb-3"
      >
        <ArrowLeft size={16} />
        Back
      </Button>

      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          {task.identifier && (
            <span className="text-sm font-mono text-neutral-500 dark:text-neutral-400">
              {task.identifier}
            </span>
          )}
          {task.state && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: task.state.color
                  ? `${task.state.color}20`
                  : undefined,
                color: task.state.color || undefined
              }}
            >
              {task.state.name}
            </span>
          )}
        </div>
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
          {task.title}
        </h1>
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#F48120] hover:underline text-sm"
        >
          View in Linear →
        </a>
      </div>

      {/* Meta Info */}
      <div className="flex flex-wrap gap-4 text-sm mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
        {task.assignee && (
          <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <User size={14} />
            <span>{task.assignee.displayName || task.assignee.name}</span>
          </div>
        )}
        <div className={`flex items-center gap-1.5 ${priorityColor}`}>
          <Flag size={14} />
          <span>{priorityLabel}</span>
        </div>
        {task.createdAt && (
          <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <CalendarBlank size={14} />
            <span>{new Date(task.createdAt).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Labels */}
      {task.labels && task.labels.length > 0 && (
        <div className="mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 flex-wrap">
            <Tag size={14} className="text-neutral-500" />
            {task.labels.map((label) => (
              <span
                key={label.id}
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: label.color
                    ? `${label.color}20`
                    : "var(--color-neutral-200)",
                  color: label.color || undefined
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {task.description && (
        <div className="mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">
            Description
          </h2>
          <div className="markdown-body text-sm">
            <Streamdown>{task.description}</Streamdown>
          </div>
        </div>
      )}

      {/* Comments */}
      <div>
        <h2 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide">
          Comments {task.comments && task.comments.length > 0 && `(${task.comments.length})`}
        </h2>
        {!task.comments || task.comments.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-500 italic">
            No comments yet
          </p>
        ) : (
          <div className="space-y-3">
            {task.comments.map((comment) => (
              <div
                key={comment.id}
                className="border-l-2 border-neutral-200 dark:border-neutral-700 pl-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {comment.user?.displayName || comment.user?.name || "Unknown"}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(comment.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </span>
                </div>
                <div className="markdown-body text-sm">
                  <Streamdown>{comment.body}</Streamdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
