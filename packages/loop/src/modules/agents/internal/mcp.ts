/** MCP servers as tools: connect, list, and register each MCP tool as a pi-durable tool the agent may call. */
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

export interface McpServer { name: string; command: string; args?: string[]; env?: Record<string, string> }

/** The tools of one stdio MCP server, named `mcp__<server>__<tool>`, and the client to close when the run ends. */
export const mcpTools = async (server: McpServer): Promise<{ tools: ToolRegistration[]; close: () => Promise<void> }> => {
  const client = new McpClient({ name: "loop", version: "0.0.0" });
  await client.connect(new StdioTransport({ command: server.command, args: server.args ?? [], ...(server.env ? { env: server.env } : {}) }));
  const tools = (await client.listTools()).map((t) => defineTool({
    name: `mcp__${server.name}__${t.name}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64),
    description: t.description ?? t.name,
    parameters: { ...t.inputSchema, type: "object", properties: t.inputSchema.properties ?? {} },
    execute: async (args: Record<string, unknown>) => {
      const result = await client.callTool(t.name, args);
      if (result.isError) throw new Error(JSON.stringify(toLlmContent(result)).slice(0, 500));
      return { output: toLlmContent(result) };
    },
  }));
  return { tools, close: () => client.close() };
};
