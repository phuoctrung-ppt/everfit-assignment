---
name: zod-validation
description: Designs Zod schemas in packages/shared-types/common for API contracts shared,  configuration between NestJS and Next.js. Use for DTOs, forms, schema versioning with createZodDto and zodResolver.
---

# Zod Shared Types

## Single Source of Truth

All schemas: `/src/schemas/`

Export: `export const XSchema = z.object(...)` + `export type XDto = z.infer<typeof XSchema>`

## NestJS

```typescript
import { createZodDto } from 'nestjs-zod';
export class CreateJobDto extends createZodDto(CreateJobSchema) {}
```

## Next.js

```typescript
useForm({ resolver: zodResolver(CreateJobSchema) })
```

## Versioning

Breaking changes: `CreateJobSchemaV2`; API `/api/v1` vs `/api/v2`

Zero runtime deps except `zod` in shared-types package.
