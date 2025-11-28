import { McpSetup } from "@/components/mcp-setup/McpSetup";
import { Link } from "react-router-dom";

export default function Setup() {
  // Use a default agent ID for MCP setup
  // The Chat agent will be accessed at /agents/Chat/default
  const agentId = "default";

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link
            to="/"
            className="text-[#F48120] hover:underline inline-flex items-center gap-1"
          >
            ← Back to Home
          </Link>
        </div>

        <McpSetup agentId={agentId} />
      </div>
    </div>
  );
}
