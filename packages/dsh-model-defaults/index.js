/** Build plain deployment defaults so the upstream settings editor can merge them.
 * Only the environment-variable name for the credential is serialized. CubeEgress
 * owns its value; neither this bundle nor the tenant profile stores that secret.
 */

/** @param {object} env Deployment model metadata. @returns {object[]} Profile patches. */
export function modelDefaults(env) {
  if (!env.MODEL_PROVIDER_ID) return []
  const model = {
    id: env.MODEL_ID,
    name: env.MODEL_NAME || env.MODEL_ID,
    ...(env.MODEL_INPUT ? { input: env.MODEL_INPUT.split(',').map(value => value.trim()).filter(Boolean) } : {}),
    ...(env.MODEL_REASONING_EFFORTS ? {
      reasoningEfforts: Object.fromEntries(env.MODEL_REASONING_EFFORTS.split(',').map(value => value.trim()).filter(Boolean).map(value => [value, value])),
    } : {}),
  }
  return [{
    id: 'llm-pi-ai',
    config: { providers: { [env.MODEL_PROVIDER_ID]: {
      api: env.MODEL_API || 'openai-completions',
      displayName: env.MODEL_PROVIDER_NAME || env.MODEL_PROVIDER_ID,
      baseURL: env.MODEL_BASE_URL,
      apiKeyEnv: 'MODEL_API_KEY',
      ...(env.MODEL_COMPAT ? { compat: JSON.parse(env.MODEL_COMPAT) } : {}),
      models: [model],
    } } },
  }, {
    id: 'agent-default-model',
    config: {
      provider: env.MODEL_PROVIDER_ID,
      model: env.MODEL_ID,
      ...(env.MODEL_DEFAULT_EFFORT ? { reasoningEffort: env.MODEL_DEFAULT_EFFORT } : {}),
    },
  }]
}
