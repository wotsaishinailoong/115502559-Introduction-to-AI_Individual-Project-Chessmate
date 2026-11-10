import { settingsHandlers } from '../../../../lib/tutor-settings-server.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = settingsHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
