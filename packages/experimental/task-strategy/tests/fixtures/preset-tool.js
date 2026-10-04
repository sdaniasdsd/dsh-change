export const name = 'strategy-fixture-tool'
export const inject = ['tools']
export function apply(ctx, config) {
  ctx.tools.register({
    name: config.tool,
    description: 'A fixture capability',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => config.tool,
  })
}
