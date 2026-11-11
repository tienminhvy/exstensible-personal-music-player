import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

const required = (name: string) => {
    return (value: string | undefined): string => {
        if (value === undefined) throw new Error(`${name} is required at runtime`);
        return value;
    };
};

// Optional during build ("building"): SvelteKit analyses the app by
// running it, and the deployment must not be coupled to build-time
// credentials.
export const variables = defineEnvVars({
    YOUTUBE_API_KEY: { schema: (value) => value ?? '' },
    DATABASE_URL: { schema: building ? (value) => value ?? '' : required('DATABASE_URL') },
    MEDIA_DIR: { schema: building ? (value) => value ?? '' : required('MEDIA_DIR') }
});
