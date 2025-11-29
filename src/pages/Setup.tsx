import { McpSetup } from "@/components/mcp-setup/McpSetup";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@/components/button/Button";

export default function Setup() {
  const navigate = useNavigate();
  // Use a default agent ID for MCP setup
  // The Chat agent will be accessed at /agents/Chat/default
  const agentId = "default";

  return (
    <div className="p-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/")}
        className="mb-4"
      >
        <ArrowLeft size={16} />
        Back to Tasks
      </Button>

      <McpSetup agentId={agentId} />
    </div>
  );
}
