import type { Static } from '@elysiumjs/core';

import { t } from 'elysia';

export class LoginValidator {
    /**
     * The validation schema for the validator.
     *
     * Define here the requirements for the data that needs to be validated.
     *
     * @example
     * ```ts
     * t.Object({
     *     username: t.String(),
     *     password: t.String()
     * })
     * ```
     *
     * If you need to customize the error messages, you can use the `error` property in the schema options:
     *
     * @example
     * ```ts
     * t.Object({
     *     username: t.String({ error: 'Username is required' }),
     *     password: t.String({ error: 'Password is required' })
     * })
     * ```
     *
     * The error property can also be a function that returns a string:
     *
     * @example
     * ```ts
     * t.Object({
     *     username: t.String({ error: ({ errors, type, validation, value }) => 'Username is required' }),
     *     password: t.String({ error: ({ errors, type, validation, value }) => 'Password is required' })
     * })
     */
    public static readonly schema = t.Object({});
}

export type LoginRequest = Static<typeof LoginValidator.schema>;
