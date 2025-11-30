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
    console.log(
      `[UI] Fetching servers from /agents/chat/${agentId}/mcp-servers`
    );
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
    const token =
      name === "GitHub"
        ? githubToken
        : name === "Linear"
          ? linearToken
          : undefined;

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
      alert(
        `${name} is already connected! Disconnect it first if you want to reconnect.`
      );
      return;
    }

    setConnecting(name);
    try {
      console.log(
        `[UI] Sending request to /agents/chat/${agentId}/mcp-servers`
      );
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
      const response = await fetch(
        `/agents/chat/${agentId}/mcp-servers/${serverId}`,
        {
          method: "DELETE"
        }
      );
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

  const capitalizeState = (state: string) => {
    return state.charAt(0).toUpperCase() + state.slice(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">MCP Server Setup</h2>
        <p className="text-neutral-600 dark:text-neutral-400">
          Connect to Model Context Protocol servers to enable advanced
          integrations
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Servers</h3>
        {predefinedServers.map((server) => {
          const connected = serverList.find((s) => s.name === server.name);
          const isConnecting = connecting === server.name;
          const isHovered = hoveredServer === server.name;
          const needsToken = !connected;

          // State machine for button appearance
          type ButtonState =
            | { type: "disconnected" }
            | { type: "connecting" }
            | { type: "ready" }
            | { type: "ready-hovered" }
            | { type: "failed" }
            | { type: "in-progress" };

          const getButtonState = (): ButtonState => {
            if (isConnecting) return { type: "connecting" };
            if (!connected) return { type: "disconnected" };
            if (connected.state === "ready" && isHovered)
              return { type: "ready-hovered" };
            if (connected.state === "ready") return { type: "ready" };
            if (connected.state === "failed") return { type: "failed" };
            return { type: "in-progress" };
          };

          const buttonState = getButtonState();

          const getButtonProps = (state: ButtonState) => {
            switch (state.type) {
              case "disconnected":
                return {
                  text: "Connect",
                  variant: "secondary" as const,
                  className: ""
                };
              case "connecting":
                return {
                  text: "Connecting...",
                  variant: "secondary" as const,
                  className: ""
                };
              case "ready":
                return {
                  text: "Ready",
                  variant: "secondary" as const,
                  className: "!text-green-600 dark:!text-green-400"
                };
              case "ready-hovered":
                return {
                  text: "Disconnect",
                  variant: "secondary" as const,
                  className:
                    "!bg-red-600 hover:!bg-red-700 !text-white !border-red-600"
                };
              case "failed":
                return {
                  text: "Failed",
                  variant: "destructive" as const,
                  className: ""
                };
              case "in-progress":
                return {
                  text: capitalizeState(connected?.state || "connecting"),
                  variant: "secondary" as const,
                  className: ""
                };
            }
          };

          const buttonProps = getButtonProps(buttonState);

          const getStateColor = () => {
            if (!connected) return "";
            switch (connected.state) {
              case "ready":
                return "text-green-600 dark:text-green-400";
              case "failed":
                return "text-red-600 dark:text-red-400";
              case "connecting":
              case "authenticating":
              case "discovering":
                return "text-yellow-600 dark:text-yellow-400";
              default:
                return "text-neutral-600 dark:text-neutral-400";
            }
          };

          return (
            <Card key={server.name} className="p-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{server.name}</h4>
                      {connected && (
                        <span className={`text-sm ${getStateColor()}`}>
                          • {capitalizeState(connected.state)}
                        </span>
                      )}
                    </div>
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
                      variant={buttonProps.variant}
                      className={buttonProps.className}
                      onClick={() =>
                        connected
                          ? disconnectServer(connected.id)
                          : connectServer(server.name, server.url)
                      }
                      onMouseEnter={() => setHoveredServer(server.name)}
                      onMouseLeave={() => setHoveredServer(null)}
                      disabled={isConnecting}
                    >
                      {buttonProps.text}
                    </Button>
                  </div>
                </div>

                {needsToken && (
                  <div className="pt-2">
                    <label className="block text-sm font-medium mb-1">
                      {server.name === "GitHub"
                        ? "GitHub Personal Access Token"
                        : "Linear API Key"}
                    </label>
                    <input
                      type="password"
                      value={
                        server.name === "GitHub" ? githubToken : linearToken
                      }
                      onChange={(e) =>
                        server.name === "GitHub"
                          ? setGithubToken(e.target.value)
                          : setLinearToken(e.target.value)
                      }
                      placeholder={
                        server.name === "GitHub" ? "ghp_..." : "lin_api_..."
                      }
                      className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    />
                    <p className="text-xs text-neutral-500 mt-1">
                      Create a token at{" "}
                      <a
                        href={
                          server.name === "GitHub"
                            ? "https://github.com/settings/tokens"
                            : "https://linear.app/settings/api"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#F48120] hover:underline"
                      >
                        {server.name === "GitHub"
                          ? "github.com/settings/tokens"
                          : "linear.app/settings/api"}
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
