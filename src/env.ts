export const ENV_VARS_TOOL = {
  type: "function" as const,
  function: {
    name: "list_env_vars",
    description:
      "List the names of all environment variables currently set. Does not reveal values, only variable names.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export function handleEnvVarsToolCall(): string {
  const names = Object.keys(process.env).sort();
  return `## Environment Variables (${names.length} set)\n\n${names.join("\n")}`;
}
