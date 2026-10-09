import {
  EnvironmentSchema,
  type Environment,
} from '../schemas/environment.schema';

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  const result = EnvironmentSchema.safeParse(values);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
