import { Hono } from 'hono';
import type { AppVariables } from '../types';
import hotspot from './hotspot';

const routes = new Hono<{ Variables: AppVariables }>();

routes.route('/hotspot', hotspot);

export default routes;
