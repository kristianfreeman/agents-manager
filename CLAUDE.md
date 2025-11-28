# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-powered task management and research system built with the `agents` SDK on Cloudflare Workers. It combines:
- **Task Manager**: Claim tasks from Linear and run AI-powered research to gather context
- **MCP Integration**: Connect to Linear and GitHub via Model Context Protocol for deep workspace integration
- **AI Chat**: Interactive chat interface with tool execution and scheduling capabilities
- **Research Agent**: Automatically finds relevant code, similar tickets, and creates git branches

## Development Commands

### Local Development
```bash
npm start              # Start local development server (alias for npm run dev)
npm run dev            # Start local development server with hot reload
```

### Testing
```bash
npm test               # Run tests with Vitest
```

### Building and Deployment
```bash
npm run deploy         # Build and deploy to Cloudflare Workers
npm run check          # Run Prettier check, Biome lint, and TypeScript check
npm run format         # Format code with Prettier
npm run types          # Generate TypeScript types from Wrangler bindings
```

## Environment Setup

Required environment variables (create `.dev.vars` for local development):
```
OPENAI_API_KEY=your_openai_api_key_here
```

Upload secrets to production:
```bash
wrangler secret bulk .dev.vars
```

## Architecture

### Core Components

**Backend (Cloudflare Workers)**
- `src/server.ts` - Main Worker entry point
  - Exports `Chat` class extending `AIChatAgent` from `agents/ai-chat-agent`
  - Exports `TaskManager` class extending `Agent` from `agents`
  - Routes requests via `routeAgentRequest()` for agent-based routing
  - Both agents use Durable Objects with SQLite storage

**Chat Agent** (`Chat` class in `src/server.ts`)
  - Implements `onRequest()` for MCP server management:
    - `GET /mcp-servers` - List connected MCP servers and tools
    - `POST /mcp-servers` - Connect new MCP server (handles OAuth)
    - `DELETE /mcp-servers/:id` - Disconnect MCP server
  - Implements `onChatMessage()` for streaming AI responses
  - Implements `executeTask()` for scheduled task execution
  - Automatically merges MCP tools with local tools via `this.mcp.getAITools()`

**TaskManager Agent** (`TaskManager` class in `src/task-manager.ts`)
  - Implements `onRequest()` for task management:
    - `GET /tasks` - List all claimed tasks
    - `POST /tasks` - Claim a new task from Linear
    - `GET /tasks/:id` - Get task details and research results
    - `POST /tasks/:id/research` - Start AI-powered research
    - `DELETE /tasks/:id` - Unclaim a task
  - Uses SQLite to store task state and research results
  - Research includes: relevant files, similar tickets, branch creation, code analysis

**Tools System**
- `src/tools.ts` - AI tool definitions using Vercel AI SDK
  - Tools with `execute` function: Auto-execute without confirmation
  - Tools without `execute` function: Require human-in-the-loop confirmation
  - Confirmation implementations go in `executions` object
  - `toolsRequiringConfirmation` in `app.tsx` must match tools without `execute`
  - Built-in tools: scheduling (`scheduleTask`), task management (`getScheduledTasks`, `cancelScheduledTask`)

**Frontend (React + React Router)**
- `src/client.tsx` - Client-side entry point with routing
- `src/pages/Home.tsx` - Task inbox showing claimed tasks
- `src/pages/Chat.tsx` - AI chat UI (formerly `src/app.tsx`)
  - Uses `useAgent()` hook from `agents/react` to connect to Chat agent
  - Uses `useAgentChat()` for chat-specific functionality
  - Manages tool confirmation dialogs for human-in-the-loop flow
- `src/pages/Setup.tsx` - MCP server configuration page
- `src/components/mcp-setup/McpSetup.tsx` - MCP connection UI
  - Connect to Linear and GitHub MCP servers
  - Handle OAuth flows
  - Display available tools from connected servers
- `src/components/` - Reusable UI components (cards, buttons, inputs, etc.)

**Utilities**
- `src/utils.ts` - Message processing and tool call handling
  - `processToolCalls()` - Handles human-in-the-loop confirmations
  - `cleanupMessages()` - Removes incomplete tool calls to prevent API errors

### Configuration Files

**wrangler.jsonc** - Cloudflare Workers configuration
- Durable Object bindings for `Chat` and `TaskManager` agents
- SQLite storage via `migrations.new_sqlite_classes` (v1: Chat, v2: TaskManager)
- Workers AI binding (remote)
- Static assets served from `public/` directory with SPA fallback routing
- Run `npm run types` after modifying to regenerate TypeScript bindings

**vite.config.ts** - Build configuration
- React plugin with hot reload
- Cloudflare plugin for local development
- Tailwind CSS v4 via Vite plugin
- Path alias: `@/` maps to `./src/`

**vitest.config.ts** - Test configuration
- Uses `@cloudflare/vitest-pool-workers` for Workers-compatible tests
- References `wrangler.jsonc` for environment setup

## Key Patterns

### Agent Implementation
When extending the `Chat` agent:
1. The `Chat` class extends `AIChatAgent<Env>` (from `agents/ai-chat-agent`)
2. Implement `onChatMessage()` to handle streaming responses
3. Use `this.messages` to access chat history
4. Use `this.mcp.connect()` to connect to MCP servers
5. Use `this.schedule()`, `this.getSchedules()`, `this.cancelSchedule()` for task scheduling

### Tool Development
Adding new tools to `tools.ts`:
1. **Auto-executing tool** (low-risk, no oversight needed):
   ```typescript
   const myTool = tool({
     description: "...",
     inputSchema: z.object({ /* params */ }),
     execute: async (params) => { /* implementation */ }
   });
   ```

2. **Confirmation-required tool** (requires user approval):
   ```typescript
   // In tools object
   const myTool = tool({
     description: "...",
     inputSchema: z.object({ /* params */ })
     // NO execute function
   });

   // In executions object
   export const executions = {
     myTool: async (params) => { /* implementation after user confirms */ }
   };
   ```

3. Update `toolsRequiringConfirmation` array in `app.tsx` to match tools without `execute`

### MCP Integration

**Connecting MCP Servers**
- Official MCP servers: Linear (`https://mcp.linear.app/mcp`), GitHub (`https://api.githubcopilot.com/mcp/`)
- Connect via UI at `/setup` or programmatically via Chat agent's `onRequest()` endpoints
- Use `this.addMcpServer(name, url)` - returns `{ id, authUrl }` if OAuth required
- Connection state persists in agent's SQLite storage

**Using MCP Tools**
- Get tools via `this.mcp.getAITools()` - returns AI SDK-compatible tools
- Merge with local tools: `{ ...tools, ...this.mcp.getAITools() }`
- Tools are automatically namespaced by server ID to prevent conflicts
- Check connection state via `this.getMcpServers()`

**MCP Server Lifecycle**
- `registerServer()` - Pre-configure without connecting
- `connectToServer()` - Establish connection
- `discoverIfConnected()` - Check capabilities
- `closeConnection()` - Close specific server
- `closeAllConnections()` - Close all servers

### Message Processing
The message flow in `onChatMessage()`:
1. Clean up incomplete tool calls with `cleanupMessages()`
2. Process pending tool calls with `processToolCalls()` (handles confirmations)
3. Stream AI response with `streamText()`
4. Merge result into UI stream with `writer.merge()`

### Component Development
- All components use TypeScript and React 19
- Styling uses Tailwind CSS v4
- Import components from `@/components/` using path alias
- Theme management via localStorage with "dark" and "light" modes

## Cloudflare-Specific Patterns

### Bindings
- Access Workers AI: `env.AI`
- Access Chat Durable Object: `env.Chat`
- Access TaskManager Durable Object: `env.TaskManager`
- Static assets: `env.ASSETS`
- Environment variables via `env.*` (set in `.dev.vars` locally)
- **Important**: After adding new Durable Object bindings in `wrangler.jsonc`:
  1. Run `npm run types` to update `env.d.ts`
  2. Restart the dev server to pick up new bindings

### Agent Routing
Three routing patterns supported:
1. **Routed addressing** (recommended for React apps):
   ```typescript
   return await routeAgentRequest(request, env);
   ```
   Routes to `/agents/:agent/:name`

2. **Named addressing**:
   ```typescript
   const agent = getAgentByName(env.Chat, 'agent-name');
   return await agent.fetch(request);
   ```

3. **Durable Objects-style addressing**:
   ```typescript
   const id = env.Chat.newUniqueId();
   const agent = env.Chat.get(id);
   return await agent.fetch(request);
   ```

## Important Notes

- The project uses the `agents` SDK (v0.2.24+) - refer to Cloudflare Agents documentation
- AI model: OpenAI GPT-4o (configurable in `server.ts`)
- Vercel AI SDK (`ai` package) provides tool and streaming utilities
- Human-in-the-loop confirmations are handled client-side in `app.tsx`
- Task scheduling supports: delays (seconds), specific dates, and cron patterns
- All scheduled tasks call the `executeTask()` method on the agent
