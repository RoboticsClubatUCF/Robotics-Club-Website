import { zod as _zod, zodClient as _zodClient } from 'sveltekit-superforms/adapters';
import type { ZodObjectType, ValidationAdapter, ClientValidationAdapter } from 'sveltekit-superforms/adapters';
import type { z } from 'zod/v3';

type AnyZodObject = z.ZodObject<any, any, any>;

// Superforms v2's ZodObjectType = ZodType<Record<string, unknown>> is structurally
// incompatible with concrete Zod 3.25+ schemas in strict TS mode because TypeScript
// infers ZodError<T> as invariant, making ZodError<{field:string}> not assignable to
// ZodError<Record<string,unknown>>. This wrapper casts internally but preserves full
// type inference for form.data.*
export function zod<T extends AnyZodObject>(schema: T): ValidationAdapter<z.infer<T>, z.input<T>> {
	return _zod(schema as unknown as ZodObjectType) as ValidationAdapter<z.infer<T>, z.input<T>>;
}

export function zodClient<T extends AnyZodObject>(
	schema: T
): ClientValidationAdapter<z.infer<T>, z.input<T>> {
	return _zodClient(schema as unknown as ZodObjectType) as ClientValidationAdapter<
		z.infer<T>,
		z.input<T>
	>;
}
