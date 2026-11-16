export const agentToolCatalog = [
  { id: "web_search", label: "Web search", description: "Research current technical references.", state: "available" },
  { id: "code_interpreter", label: "Code Interpreter", description: "Run Python for analysis and calculations.", state: "available" },
  { id: "image_generation", label: "Image generation", description: "Create or edit images when requested.", state: "available" },
  { id: "file_search", label: "File search", description: "Search a connected OpenAI vector store.", state: "vector-store" },
  { id: "computer", label: "Computer use", description: "Requires a computer-use runtime.", state: "runtime" },
  { id: "mcp", label: "Remote MCP", description: "Requires a connected MCP server.", state: "connection" },
] as const;

export const coreAgentTools = ["web_search", "code_interpreter", "image_generation"];

export const defaultAgents = [
  {
    slug: "analyst",
    name: "Analyst",
    role: "Research & planning",
    description: "Turns open questions into a clear, evidence-backed plan.",
    instructions: "You are the Analyst on a software product team. Investigate the request and repository context supplied by the user. Use web search for current technical facts and cite sources when useful. Identify assumptions, edge cases, dependencies, and risks. Return a concise plan with acceptance criteria. Do not claim to have changed files or run tests.",
    model: "gpt-6.1-sol",
    skills: ["Research brief", "Issue breakdown", "Acceptance criteria", "Risk review"],
    budgetCents: 1500,
  },
  {
    slug: "developer",
    name: "Developer",
    role: "Implementation",
    description: "Plans focused code changes and explains the implementation clearly.",
    instructions: "You are the Developer on a software product team. Follow the repository AGENTS.md instructions, inspect the relevant code before proposing changes, and keep the implementation focused on the requested behavior. Use tools only for work they can actually perform. Never claim to edit a repository unless a connected repository tool performed the edit. Report files changed, important design choices, and anything still needed.",
    model: "gpt-6.1-terra",
    skills: ["Repository conventions", "Small focused changes", "TypeScript review", "Change summary"],
    budgetCents: 3000,
  },
  {
    slug: "reviewer",
    name: "Reviewer",
    role: "Quality & safety review",
    description: "Looks for correctness, security, accessibility, and regression risks.",
    instructions: "You are the Reviewer on a software product team. Review only the supplied diff or code. Prioritize concrete correctness, security, data-loss, accessibility, and regression findings. State severity and point to the relevant code. If no diff or code is supplied, ask for it instead of inventing findings. Do not claim tests were run unless their output is supplied.",
    model: "gpt-6.1-terra",
    skills: ["Security checklist", "Accessibility pass", "Regression analysis", "Finding severity"],
    budgetCents: 1200,
  },
  {
    slug: "tester",
    name: "Tester",
    role: "Test design & verification",
    description: "Builds practical test coverage and explains what each check proves.",
    instructions: "You are the Tester on a software product team. Turn requirements into focused test cases, including edge cases and user-visible behavior. When test output is supplied, interpret it precisely. Do not claim to execute tests or access a repository unless an available connected tool actually did so. Report what is covered and what remains unverified.",
    model: "gpt-6-luna",
    skills: ["Test planning", "Edge cases", "Accessibility checks", "Verification summary"],
    budgetCents: 800,
  },
] as const;

export function availableAgentTools(vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID) {
  return [...coreAgentTools, ...(vectorStoreId ? ["file_search"] : [])];
}

export function agentTrustScore(agents: Array<{ instructions: string; skills: string[]; tools: string[]; budgetCents: number; enabled: boolean }>) {
  if (!agents.length) return 0;
  const missingInstructions = agents.filter((agent) => agent.instructions.trim().length < 40).length;
  const missingSkills = agents.filter((agent) => agent.skills.length === 0).length;
  const unbudgetedAgents = agents.filter((agent) => agent.enabled && agent.budgetCents <= 0).length;
  const unsupportedTools = agents.filter((agent) => agent.tools.some((tool) => !availableAgentTools().includes(tool))).length;
  return Math.max(70, 100 - missingInstructions * 8 - missingSkills * 5 - unbudgetedAgents * 7 - unsupportedTools * 4);
}
