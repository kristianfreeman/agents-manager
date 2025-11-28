import { useState, useEffect } from "react";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Loader } from "@/components/loader/Loader";

interface McpServer {
  id: string;
  name: string;
  url: string;
  state: "authenticating" | "connecting" | "ready" | "discovering" | "failed";
  authUrl?: string;
  tools?: Array<{ name: string; description: string }>;
}

interface McpSetupProps {
  agentId: string;
}

export function McpSetup({ agentId }: McpSetupProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [hoveredServer, setHoveredServer] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState<string>("");
  const [linearToken, setLinearToken] = useState<string>("");

  useEffect(() => {
    fetchServers();
  }, [agentId]);

  const fetchServers = async () => {
    console.log(`[UI] Fetching servers from /agents/chat/${agentId}/mcp-servers`);
    try {
      const response = await fetch(`/agents/chat/${agentId}/mcp-servers`);
      console.log(`[UI] Fetch servers response status: ${response.status}`);
      if (response.ok) {
        const data = (await response.json()) as {
          servers?: Record<string, McpServer> | McpServer[];
        };
        console.log(`[UI] Servers data:`, data);

        // Convert servers object to array if needed
        let serversArray: McpServer[] = [];
        if (data.servers) {
          if (Array.isArray(data.servers)) {
            serversArray = data.servers;
          } else {
            // servers is an object with server IDs as keys
            serversArray = Object.entries(data.servers).map(([id, server]) => ({
              ...server,
              id: server.id || id
            }));
          }
        }

        console.log(`[UI] Converted servers to array:`, serversArray);
        setServers(serversArray);
      }
    } catch (error) {
      console.error("Failed to fetch MCP servers:", error);
    } finally {
      setLoading(false);
    }
  };

  const connectServer = async (name: string, url: string) => {
    console.log(`[UI] ====== connectServer called ======`);
    console.log(`[UI] name: ${name}, url: ${url}`);

    // Get the appropriate token for this server
    const token = name === "GitHub" ? githubToken : name === "Linear" ? linearToken : undefined;

    console.log(`[UI] Connecting to ${name}`);
    console.log(`[UI] Token present: ${!!token}`);

    if (!token) {
      alert(`Please enter a ${name} Personal Access Token first`);
      return;
    }

    // Check if already connected
    const serverList = Array.isArray(servers) ? servers : [];
    const alreadyConnected = serverList.find((s) => s.name === name);
    if (alreadyConnected) {
      alert(`${name} is already connected! Disconnect it first if you want to reconnect.`);
      return;
    }

    setConnecting(name);
    try {
      console.log(`[UI] Sending request to /agents/chat/${agentId}/mcp-servers`);
      const response = await fetch(`/agents/chat/${agentId}/mcp-servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, serverUrl: url, authToken: token })
      });

      console.log(`[UI] Response status: ${response.status}`);

      if (response.ok) {
        const data = (await response.json()) as {
          serverId?: string;
          authUrl?: string;
          error?: string;
        };
        console.log(`[UI] Response data:`, data);

        if (data.error) {
          throw new Error(data.error);
        }

        // If authUrl is returned but we provided a token, ignore it
        // The server should connect with the Bearer token
        if (data.authUrl && !token) {
          console.log(`[UI] Opening auth URL: ${data.authUrl}`);
          // Only open OAuth if no token was provided
          window.open(data.authUrl, "_blank");
        }
        // Refresh to see if connection succeeded
        console.log(`[UI] Fetching updated server list`);
        await fetchServers();
      } else {
        const errorText = await response.text();
        console.error(`[UI] Error response:`, errorText);
        throw new Error(errorText || "Connection failed");
      }
    } catch (error) {
      console.error("[UI] Failed to connect MCP server:", error);
      alert(`Failed to connect: ${error}`);
    } finally {
      setConnecting(null);
    }
  };

  const disconnectServer = async (serverId: string) => {
    console.log(`[UI] Disconnecting server ${serverId}`);
    try {
      const response = await fetch(`/agents/chat/${agentId}/mcp-servers/${serverId}`, {
        method: "DELETE"
      });
      console.log(`[UI] Disconnect response status: ${response.status}`);

      if (response.ok) {
        console.log(`[UI] Successfully disconnected, refreshing server list`);
        await fetchServers();
      } else {
        const errorText = await response.text();
        console.error(`[UI] Failed to disconnect:`, errorText);
        alert(`Failed to disconnect: ${errorText}`);
      }
    } catch (error) {
      console.error("Failed to disconnect MCP server:", error);
      alert(`Failed to disconnect: ${error}`);
    }
  };

  const predefinedServers = [
    {
      name: "Linear",
      url: "https://mcp.linear.app/mcp",
      description: "Linear project management integration"
    },
    {
      name: "GitHub",
      url: "https://api.githubcopilot.com/mcp/",
      description: "GitHub code repository integration"
    }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader />
      </div>
    );
  }

  // Ensure servers is an array
  const serverList = Array.isArray(servers) ? servers : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">MCP Server Setup</h2>
        <p className="text-neutral-600 dark:text-neutral-400">
          Connect to Model Context Protocol servers to enable advanced
          integrations
        </p>
      </div>

      {serverList.length === 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Authentication Tokens</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Enter your API tokens to connect to MCP servers
          </p>
          <div className="grid gap-4">
            {!serverList.find(s => s.name === "GitHub") && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  GitHub Personal Access Token
                </label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_..."
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Create a token at{" "}
                  <a
                    href="https://github.com/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#F48120] hover:underline"
                  >
                    github.com/settings/tokens
                  </a>
                </p>
              </div>
            )}
            {!serverList.find(s => s.name === "Linear") && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Linear API Key
                </label>
                <input
                  type="password"
                  value={linearToken}
                  onChange={(e) => setLinearToken(e.target.value)}
                  placeholder="lin_api_..."
                  className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Create an API key at{" "}
                  <a
                    href="https://linear.app/settings/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#F48120] hover:underline"
                  >
                    linear.app/settings/api
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Available Servers</h3>
        {predefinedServers.map((server) => {
          const connected = serverList.find((s) => s.name === server.name);
          const isConnecting = connecting === server.name;
          const isHovered = hoveredServer === server.name;

          const capitalizeState = (state: string) => {
            return state.charAt(0).toUpperCase() + state.slice(1);
          };

          const getButtonText = () => {
            if (isConnecting) return "Connecting...";
            if (!connected) return "Connect";
            if (isHovered) return "Disconnect";
            return capitalizeState(connected.state || "connected");
          };

          const getButtonVariant = () => {
            if (isConnecting) return "primary";
            if (!connected) return "primary";
            if (isHovered) return "destructive";

            // Color based on state
            switch (connected.state) {
              case "ready":
                return "secondary"; // Green/success look
              case "failed":
                return "destructive";
              case "connecting":
              case "authenticating":
              case "discovering":
                return "primary";
              default:
                return "secondary";
            }
          };

          return (
            <Card key={server.name} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-semibold">{server.name}</h4>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    {server.description}
                  </p>
                  {connected?.tools && connected.tools.length > 0 && (
                    <p className="text-sm text-neutral-500 dark:text-neutral-500 mt-2">
                      {connected.tools.length} tools available
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={getButtonVariant()}
                    className={
                      !connected && !isConnecting
                        ? "bg-[#F48120] hover:bg-[#F48120]/90 text-white border-[#F48120]"
                        : connected?.state === "ready" && !isHovered
                          ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
                          : ""
                    }
                    onClick={() =>
                      connected
                        ? disconnectServer(connected.id)
                        : connectServer(server.name, server.url)
                    }
                    onMouseEnter={() => setHoveredServer(server.name)}
                    onMouseLeave={() => setHoveredServer(null)}
                    disabled={isConnecting}
                  >
                    {getButtonText()}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {serverList.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Connected Servers</h3>
          {serverList.map((server) => (
            <Card key={server.id} className="p-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">{server.name}</h4>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      server.state === "ready"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : server.state === "failed"
                          ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                    }`}
                  >
                    {server.state}
                  </span>
                </div>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {server.url}
                </p>
                {server.tools && server.tools.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium mb-1">
                      Available Tools ({server.tools.length}):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {server.tools.slice(0, 5).map((tool) => (
                        <span
                          key={tool.name}
                          className="px-2 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-800 rounded"
                          title={tool.description}
                        >
                          {tool.name}
                        </span>
                      ))}
                      {server.tools.length > 5 && (
                        <span className="px-2 py-0.5 text-xs text-neutral-500">
                          +{server.tools.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
